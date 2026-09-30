import * as path from 'path';

export interface SecretScanResult {
  hasSecrets: boolean;
  sanitizedContent: string;
  detectedPatterns: string[];
}

export class SecretScanner {
  // Sensitive filename patterns that must NEVER be scanned or included
  private static readonly SENSITIVE_FILENAME_PATTERNS = [
    /^\.env(\..+)?$/i,
    /^.*\.pem$/i,
    /^.*\.key$/i,
    /^.*\.p12$/i,
    /^.*\.pfx$/i,
    /^.*\.keystore$/i,
    /^.*\.jks$/i,
    /^credentials(\..+)?$/i,
    /^secrets?(\..+)?$/i,
    /^id_rsa(\..+)?$/i,
    /^id_dsa(\..+)?$/i,
    /^id_ecdsa(\..+)?$/i,
    /^id_ed25519(\..+)?$/i,
    /^serviceAccountKey(\..+)?$/i,
    /^auth(\..+)?\.json$/i,
    /^\.htpasswd$/i,
    /^\.dockercfg$/i,
    /^\.npmrc$/i,
  ];

  /**
   * Checks if a filename matches sensitive secret file patterns.
   */
  public static isSensitiveFileName(filePath: string): boolean {
    const fileName = path.basename(filePath);
    return this.SENSITIVE_FILENAME_PATTERNS.some((pattern) => pattern.test(fileName));
  }

  /**
   * Scans content and redacts all detected secrets, tokens, credentials, and private keys.
   */
  public static scanAndRedact(content: string): SecretScanResult {
    if (!content) {
      return { hasSecrets: false, sanitizedContent: '', detectedPatterns: [] };
    }

    let sanitized = content;
    const detectedPatterns: string[] = [];

    // 1. Private Key Blocks (RSA, EC, DSA, OPENSSH, PGP)
    const privateKeyRegex = /-----BEGIN [A-Z0-9 _-]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 _-]*PRIVATE KEY-----/gi;
    if (privateKeyRegex.test(sanitized)) {
      detectedPatterns.push('Private Key Block');
      sanitized = sanitized.replace(
        privateKeyRegex,
        '-----BEGIN PRIVATE KEY-----\n[REDACTED_PRIVATE_KEY]\n-----END PRIVATE KEY-----'
      );
    }

    // 2. JWT & Bearer Tokens
    const jwtRegex = /(bearer\s+|jwt\s*[:=]\s*["']?)eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+["']?/gi;
    if (jwtRegex.test(sanitized)) {
      detectedPatterns.push('JWT Token');
      sanitized = sanitized.replace(jwtRegex, '$1[REDACTED_JWT_TOKEN]');
    }

    // 3. Database Connection URLs with Passwords (mongodb, postgres, mysql, redis, amqp, sqlserver)
    const dbRegex = /((?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|sqlserver):\/\/[a-zA-Z0-9_.-]+:)([^@\s\r\n'"]+)(@[a-zA-Z0-9_.-]+)/gi;
    if (dbRegex.test(sanitized)) {
      detectedPatterns.push('Database Credentials');
      sanitized = sanitized.replace(dbRegex, '$1[REDACTED_PASSWORD]$3');
    }

    // 4. AWS Access Key ID
    const awsRegex = /(AKIA[0-9A-Z]{16})/g;
    if (awsRegex.test(sanitized)) {
      detectedPatterns.push('AWS Access Key');
      sanitized = sanitized.replace(awsRegex, '[REDACTED_AWS_KEY]');
    }

    // 5. OpenAI / Anthropic API Keys
    const aiKeyRegex = /(?:sk-(?:proj-|ant-)?[a-zA-Z0-9-_]{20,})/g;
    if (aiKeyRegex.test(sanitized)) {
      detectedPatterns.push('AI Provider API Key');
      sanitized = sanitized.replace(aiKeyRegex, '[REDACTED_API_KEY]');
    }

    // 6. Google Cloud / Firebase API Key
    const googleKeyRegex = /(AIza[0-9A-Za-z-_]{30,40})/g;
    if (googleKeyRegex.test(sanitized)) {
      detectedPatterns.push('Google API Key');
      sanitized = sanitized.replace(googleKeyRegex, '[REDACTED_GOOGLE_KEY]');
    }

    // 7. GitHub & GitLab Tokens (including fine-grained tokens)
    const gitTokenRegex = /(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|glpat-[a-zA-Z0-9-_]{20,})/g;
    if (gitTokenRegex.test(sanitized)) {
      detectedPatterns.push('Git Provider Token');
      sanitized = sanitized.replace(gitTokenRegex, '[REDACTED_GIT_TOKEN]');
    }

    // 8. Slack Webhooks and Tokens
    const slackRegex = /(?:xox[baprs]-[0-9a-zA-Z]{10,48}|https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]+\/B[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+)/g;
    if (slackRegex.test(sanitized)) {
      detectedPatterns.push('Slack Webhook / Token');
      sanitized = sanitized.replace(slackRegex, '[REDACTED_SLACK_SECRET]');
    }

    // 9. Stripe / SendGrid / Twilio / HuggingFace / NPM Keys
    const providerSecretRegex = /(?:sk_live_[0-9a-zA-Z]{24}|rk_live_[0-9a-zA-Z]{24}|SG\.[a-zA-Z0-9-_]{20,60}|npm_[a-zA-Z0-9]{36}|hf_[a-zA-Z0-9]{34})/g;
    if (providerSecretRegex.test(sanitized)) {
      detectedPatterns.push('Payment/Messaging Provider Key');
      sanitized = sanitized.replace(providerSecretRegex, '[REDACTED_PROVIDER_KEY]');
    }

    // 10. Sensitive Key / Password / Secret Assignments in JSON, YAML, or Code
    const sensitiveKeyRegex = /((?:api[_-]?key|apiKey|secret[_-]?key|secretKey|client[_-]?secret|clientSecret|password|passwd|auth[_-]?token|authToken|access[_-]?token|accessToken|private[_-]?key|privateKey|encryption[_-]?key|webhook[_-]?secret)\s*[:=]\s*["'])([^"'\r\n]{6,})(["'])/gi;
    if (sensitiveKeyRegex.test(sanitized)) {
      detectedPatterns.push('API Key / Password Assignment');
      sanitized = sanitized.replace(sensitiveKeyRegex, '$1[REDACTED_SECRET]$3');
    }

    // 11. Sensitive URLs with auth tokens / keys in query parameters
    const sensitiveUrlParamRegex = /([?&](?:api[_-]?key|token|secret|password|access[_-]?token|auth)=)[^&\s"'<>]{6,}/gi;
    if (sensitiveUrlParamRegex.test(sanitized)) {
      detectedPatterns.push('URL Query Parameter Secret');
      sanitized = sanitized.replace(sensitiveUrlParamRegex, '$1[REDACTED_URL_SECRET]');
    }

    return {
      hasSecrets: detectedPatterns.length > 0,
      sanitizedContent: sanitized,
      detectedPatterns: Array.from(new Set(detectedPatterns)),
    };
  }
}
