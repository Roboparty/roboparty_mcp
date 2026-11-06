import type { Laya, LayaOptions, Question, SystemOneResult } from "@receptron/laya";
import type { Config } from "./config.js";

export interface LayaHealth {
  loaded: boolean;
  loading: boolean;
  modelDir: string | null;
  cacheDir: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
}

export interface AnalyzeResult {
  result: SystemOneResult<Record<string, Question>>;
  latencyMs: number;
}

export interface Analyzer {
  analyze(state: unknown, questions: Record<string, Question>): Promise<AnalyzeResult>;
  health(): LayaHealth;
  info(): Record<string, unknown>;
  preload(): void;
  close(): Promise<void>;
}

export class LayaTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Laya analysis timed out after ${timeoutMs} ms`);
    this.name = "LayaTimeoutError";
  }
}

export class LayaAnalyzer implements Analyzer {
  private laya: Laya | null = null;
  private loadPromise: Promise<Laya> | null = null;
  private lastError: string | null = null;
  private lastLatencyMs: number | null = null;

  constructor(private readonly config: Config) {}

  private options(): LayaOptions {
    const options: LayaOptions = {
      executionProviders: this.config.executionProviders as LayaOptions["executionProviders"],
    };
    if (this.config.modelDir) options.modelDir = this.config.modelDir;
    if (this.config.cacheDir) options.cacheDir = this.config.cacheDir;
    if (this.config.repo) options.repo = this.config.repo;
    if (this.config.subfolder) options.subfolder = this.config.subfolder;
    if (this.config.revision) options.revision = this.config.revision;
    return options;
  }

  async load(): Promise<Laya> {
    if (this.laya) return this.laya;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const { Laya: LayaClass } = await import("@receptron/laya");
        const instance = await LayaClass.load(this.options());
        this.laya = instance;
        this.lastError = null;
        return instance;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  preload(): void {
    if (this.laya || this.loadPromise) return;
    void this.load().catch(() => {
      // health() exposes the error; preload must never crash the MCP process.
    });
  }

  async analyze(state: unknown, questions: Record<string, Question>): Promise<AnalyzeResult> {
    const laya = await this.load();
    const started = performance.now();
    let timeout: NodeJS.Timeout | undefined;
    const timer = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new LayaTimeoutError(this.config.timeoutMs)), this.config.timeoutMs);
    });
    try {
      const task = laya.systemOne(state, questions);
      // The model has no cancellation API; attach a handler so a late rejection
      // after the timeout does not become an unhandled rejection.
      void task.catch(() => undefined);
      const result = await Promise.race([task, timer]);
      const latencyMs = Math.round(performance.now() - started);
      this.lastLatencyMs = latencyMs;
      return { result: result as SystemOneResult<Record<string, Question>>, latencyMs };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  health(): LayaHealth {
    return {
      loaded: this.laya !== null,
      loading: this.loadPromise !== null,
      modelDir: this.laya?.modelDir ?? this.config.modelDir ?? null,
      cacheDir: this.config.cacheDir ?? null,
      lastLatencyMs: this.lastLatencyMs,
      lastError: this.lastError,
    };
  }

  info(): Record<string, unknown> {
    return {
      model: "laya",
      loaded: this.laya !== null,
      modelDir: this.laya?.modelDir ?? this.config.modelDir ?? null,
      cacheDir: this.config.cacheDir ?? null,
      repo: this.config.repo ?? null,
      subfolder: this.config.subfolder ?? null,
      revision: this.config.revision ?? null,
      executionProviders: this.config.executionProviders,
      timeoutMs: this.config.timeoutMs,
      config: this.laya?.config ?? null,
    };
  }

  async close(): Promise<void> {
    if (this.laya) {
      await this.laya.close();
      this.laya = null;
    }
  }
}
