import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

export interface OllamaConfig {
  endpoint: string;
  model: string;
  timeoutMs: number;
}

export interface OllamaModelTag {
  name: string;
  size: number;
  digest: string;
}

export interface ICancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: (listener: (e: any) => any) => { dispose(): void };
}

export class OllamaClient {
  private endpoint: string;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: OllamaConfig) {
    this.endpoint = (config.endpoint || 'http://localhost:11434').replace(/\/+$/, '');
    this.defaultModel = config.model || 'qwen2.5-coder:1.5b';
    this.timeoutMs = config.timeoutMs || 30000;
  }

  /**
   * Checks whether the local Ollama daemon is reachable.
   */
  public async isAvailable(): Promise<boolean> {
    try {
      const tags = await this.listModels();
      return tags !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Lists all available local models in Ollama dynamically.
   */
  public async listModels(): Promise<OllamaModelTag[] | undefined> {
    try {
      const response = await this.request<{ models: { name: string; size: number; digest: string }[] }>(
        'GET',
        '/api/tags',
        undefined,
        3000 // Fast 3s timeout for healthcheck
      );
      return response?.models || [];
    } catch {
      return undefined;
    }
  }

  /**
   * Checks if the specific model is installed in local Ollama.
   */
  public async hasModel(modelName: string = this.defaultModel): Promise<boolean> {
    const models = await this.listModels();
    if (!models || models.length === 0) {
      return false;
    }
    const target = modelName.toLowerCase().trim();
    return models.some((m) => {
      const name = m.name.toLowerCase().trim();
      return (
        name === target ||
        name === `${target}:latest` ||
        name.startsWith(target) ||
        target.startsWith(name)
      );
    });
  }

  /**
   * Calls Ollama generate endpoint with structured JSON mode and optimized inferencing options.
   */
  public async generate(
    prompt: string,
    modelName: string = this.defaultModel,
    timeoutMs: number = this.timeoutMs,
    customOptions?: Record<string, any>,
    cancellationToken?: ICancellationToken
  ): Promise<string> {
    const payload = {
      model: modelName,
      prompt: prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        top_p: 0.9,
        num_predict: 768,
        num_ctx: 4096,
        ...customOptions,
      },
    };

    const response = await this.request<{ response: string }>(
      'POST',
      '/api/generate',
      payload,
      timeoutMs,
      cancellationToken
    );

    if (!response || typeof response.response !== 'string') {
      throw new Error('Empty response from Ollama');
    }

    return response.response.trim();
  }

  /**
   * Calls Ollama generate endpoint without JSON constraints for detailed Markdown analysis and explanation.
   */
  public async generateText(
    prompt: string,
    modelName: string = this.defaultModel,
    timeoutMs: number = this.timeoutMs,
    customOptions?: Record<string, any>,
    cancellationToken?: ICancellationToken
  ): Promise<string> {
    const payload = {
      model: modelName,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.2,
        top_p: 0.9,
        num_predict: 1536,
        num_ctx: 4096,
        ...customOptions,
      },
    };

    const response = await this.request<{ response: string }>(
      'POST',
      '/api/generate',
      payload,
      timeoutMs,
      cancellationToken
    );

    if (!response || typeof response.response !== 'string') {
      throw new Error('Empty response from Ollama');
    }

    return response.response.trim();
  }

  private request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: any,
    timeoutMs: number = this.timeoutMs,
    cancellationToken?: ICancellationToken
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (cancellationToken?.isCancellationRequested) {
        reject(new Error('Operation cancelled by user'));
        return;
      }

      const parsedUrl = new URL(`${this.endpoint}${path}`);
      const isHttps = parsedUrl.protocol === 'https:';

      const postData = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: method,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
      };

      const requestFn = isHttps ? https.request : http.request;
      const req = requestFn(options, (res) => {
        let data = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed as T);
            } catch (e) {
              reject(new Error(`Failed to parse response: ${data}`));
            }
          } else {
            reject(new Error(`HTTP error ${res.statusCode}: ${data}`));
          }
        });
      });

      if (cancellationToken) {
        const disp = cancellationToken.onCancellationRequested(() => {
          req.destroy();
          reject(new Error('Operation cancelled by user'));
        });
        req.on('close', () => disp.dispose());
      }

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (e) => {
        reject(e);
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }
}
