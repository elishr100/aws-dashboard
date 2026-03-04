import { execSync } from 'child_process';
import { statSync, readFileSync } from 'fs';
import { parse as parseIni } from 'ini';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message,
  type ContentBlock,
  type Tool,
  type ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { ClaudeResponse } from '../types/index.js';

export class ClaudeMCPService {
  private profile: string;
  private region: string;
  private awsCredentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  } | null = null;
  private lastCredentialFetch: number = 0;
  private static readonly CREDENTIAL_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes (safer for STS temp creds)

  constructor(profile: string = 'dev-ah', region: string = 'us-west-2') {
    this.profile = profile;
    this.region = region;

    // 1. FORENSIC: Process-Level Environment Audit at initialization
    console.log('[FORENSIC] TIMESTAMP_ISO:', new Date().toISOString());
    console.log('[FORENSIC] GLOBAL_KEYS:', Object.keys(process.env).filter(k => k.startsWith('AWS_')));
    console.log(`[ClaudeMCP] Initialized with profile=${profile}, region=${region}`);
  }

  /**
   * DEBUG UTILITY: Log AWS config file timestamps and permissions
   * 5. FILESYSTEM & SYSTEM STATE
   */
  private logAWSConfigTimestamps(): void {
    const homeDir = process.env.HOME || '';
    const credentialsPath = `${homeDir}/.aws/credentials`;
    const configPath = `${homeDir}/.aws/config`;

    // 5. FORENSIC: System & Filesystem State
    console.log('[FORENSIC] TIMESTAMP_ISO:', new Date().toISOString());

    try {
      const credStats = statSync(credentialsPath);
      console.log(`[DEBUG] AWS Credentials File: ${credentialsPath}`);
      console.log(`[DEBUG]   Modified: ${credStats.mtime.toISOString()}`);
      console.log(`[DEBUG]   Accessed: ${credStats.atime.toISOString()}`);
    } catch (error: any) {
      console.log(`[DEBUG] AWS Credentials File: Not found or inaccessible`);
    }

    try {
      const configStats = statSync(configPath);
      console.log(`[DEBUG] AWS Config File: ${configPath}`);
      console.log(`[DEBUG]   Modified: ${configStats.mtime.toISOString()}`);
      console.log(`[DEBUG]   Accessed: ${configStats.atime.toISOString()}`);
    } catch (error: any) {
      console.log(`[DEBUG] AWS Config File: Not found or inaccessible`);
    }

    // FILESYSTEM STATE: Run ls -la to check permissions and access
    console.log(`\n[DIAGNOSTIC] FILESYSTEM_STATE:`);

    // 1. FORENSIC: Environment Snapshot before execSync (ls -la credentials)
    console.log('[FORENSIC] ENV_KEYS:', Object.keys(process.env).filter(k => k.startsWith('AWS')));
    console.log('[FORENSIC] TIMESTAMP:', new Date().toISOString());
    try {
      const awsVersion = execSync('aws --version', { encoding: 'utf-8' }).trim();
      console.log('[FORENSIC] AWS_VERSION:', awsVersion);
    } catch (e: any) {
      console.log('[FORENSIC] AWS_VERSION: ERROR -', e.message);
    }

    try {
      const credLsCmd = `ls -la ${credentialsPath}`;
      console.log('[FORENSIC] RAW_COMMAND:', credLsCmd);
      const credLs = execSync(credLsCmd, { encoding: 'utf-8' });
      console.log(`[DIAGNOSTIC]   credentials file (ls -la): ${credLs.trim()}`);
    } catch (error: any) {
      console.log('[FORENSIC] TIMESTAMP:', new Date().toISOString());
      console.log('[FORENSIC] FULL_STDOUT:', error.stdout || '(empty)');
      console.log('[FORENSIC] FULL_STDERR:', error.stderr || '(empty)');
      console.log(`[DIAGNOSTIC]   credentials file: NOT ACCESSIBLE (${error.message})`);
    }

    // 1. FORENSIC: Environment Snapshot before execSync (ls -la config)
    console.log('[FORENSIC] ENV_KEYS:', Object.keys(process.env).filter(k => k.startsWith('AWS')));
    console.log('[FORENSIC] TIMESTAMP:', new Date().toISOString());
    try {
      const configLsCmd = `ls -la ${configPath}`;
      console.log('[FORENSIC] RAW_COMMAND:', configLsCmd);
      const configLs = execSync(configLsCmd, { encoding: 'utf-8' });
      console.log('[FORENSIC] CONFIG_PERMS:', configLs.trim());
      console.log(`[DIAGNOSTIC]   config file (ls -la): ${configLs.trim()}`);
    } catch (error: any) {
      console.log('[FORENSIC] TIMESTAMP:', new Date().toISOString());
      console.log('[FORENSIC] FULL_STDOUT:', error.stdout || '(empty)');
      console.log('[FORENSIC] FULL_STDERR:', error.stderr || '(empty)');
      console.log('[FORENSIC] CONFIG_PERMS: NOT ACCESSIBLE');
      console.log(`[DIAGNOSTIC]   config file: NOT ACCESSIBLE (${error.message})`);
    }
  }

  /**
   * DEBUG UTILITY: Analyze credential type and log metadata
   * 2. CREDENTIAL FORENSIC DATA
   */
  private logCredentialMetadata(accessKeyId: string, secretKey: string, sessionToken?: string): void {
    // Determine credential type
    const isStaticKey = accessKeyId.startsWith('AKIA');
    const isTempKey = accessKeyId.startsWith('ASIA');
    const keyType = isStaticKey ? 'STATIC' : isTempKey ? 'TEMP' : 'UNKNOWN';
    const keyTypeLabel = isStaticKey
      ? 'Permanent (AKIA)'
      : isTempKey
        ? 'Temporary (ASIA)'
        : 'Unknown';

    // 2. FORENSIC: Credential Data with prefix (first 4 chars) and lengths
    console.log('[FORENSIC] CRED_DATA:', {
      Type: accessKeyId.startsWith('AKIA') ? 'STATIC (AKIA)' : 'TEMP (ASIA)',
      Prefix: accessKeyId.substring(0, 4),
      AccessKeyLen: accessKeyId.length,
      TokenLen: sessionToken?.length || 0,
      SecretLen: secretKey.length
    });

    console.log(`[DEBUG] FETCHED_CREDS: {`);
    console.log(`[DEBUG]   type: '${keyType}',`);
    console.log(`[DEBUG]   id_prefix: '${accessKeyId.substring(0, 4)}',`);
    console.log(`[DEBUG]   id_length: ${accessKeyId.length},`);
    console.log(`[DEBUG]   secret_length: ${secretKey.length},`);
    console.log(`[DEBUG]   token_len: ${sessionToken ? sessionToken.length : 0},`);
    console.log(`[DEBUG]   has_token: ${!!sessionToken}`);
    console.log(`[DEBUG] }`);
    console.log(`[DEBUG] Credential Type (readable): ${keyTypeLabel}`);
    console.log(`[DEBUG]   AccessKeyId: ${accessKeyId.substring(0, 5)}... (length: ${accessKeyId.length})`);
    console.log(`[DEBUG]   SecretKey: ${secretKey.substring(0, 5)}... (length: ${secretKey.length})`);

    if (sessionToken) {
      console.log(`[DEBUG]   SessionToken: ${sessionToken.substring(0, 5)}... (length: ${sessionToken.length})`);
    } else {
      console.log(`[DEBUG]   SessionToken: NOT PRESENT`);
    }

    // FORENSIC FORMAT: Exact format as requested
    console.log(`[DIAGNOSTIC] FETCHED_CREDS: { ID_Type: '${keyType}', ID_Prefix: '${accessKeyId.substring(0, 5)}', Token_Len: ${sessionToken?.length || 0}, Secret_Len: ${secretKey.length} }`);
  }

  /**
   * Get AWS credentials with STRICT environment isolation and STS cache bypass
   * 1. Check if cached credentials are still fresh (< 5 min old)
   * 2. Use ABSOLUTE minimal environment (PATH, HOME, USER ONLY - NO AWS_ variables)
   * 3. Force fresh credentials via aws sts get-session-token (bypasses CLI cache)
   * 4. Validate credentials with sts get-caller-identity test
   */
  private getAWSCredentials(forceRefresh: boolean = false): void {
    console.log(`\n============ [FORENSIC] getAWSCredentials START ============`);
    console.log('[FORENSIC] SYSTEM_TIME_ISO:', new Date().toISOString());

    // 1. GLOBAL PROCESS AUDIT: Log every key in process.env that starts with AWS_
    console.log('[FORENSIC] GLOBAL_PROCESS_KEYS:', Object.keys(process.env).filter(k => k.startsWith('AWS_')));

    console.log(`[DEBUG] forceRefresh: ${forceRefresh}`);
    console.log(`[DEBUG] profile: ${this.profile}`);

    try {
      const now = Date.now();
      const cacheAge = now - this.lastCredentialFetch;

      // If we have cached credentials and they're fresh, use them
      if (!forceRefresh && this.awsCredentials && cacheAge < ClaudeMCPService.CREDENTIAL_CACHE_TTL_MS) {
        console.log(`[ClaudeMCP] Using cached credentials (age: ${Math.floor(cacheAge / 1000)}s)`);

        // 2. CREDENTIAL METADATA: Log credential state with exact format
        const id = this.awsCredentials.accessKeyId;
        const token = this.awsCredentials.sessionToken;
        console.log('[FORENSIC] CRED_STATE:', {
          Type: id.startsWith('AKIA') ? 'STATIC' : 'TEMP',
          Prefix: id.substring(0, 5),
          TokenLen: token?.length || 0
        });

        this.logCredentialMetadata(
          this.awsCredentials.accessKeyId,
          this.awsCredentials.secretAccessKey,
          this.awsCredentials.sessionToken
        );
        console.log(`============ [FORENSIC] getAWSCredentials END (cached) ============\n`);
        return;
      }

      if (forceRefresh) {
        console.log(`[ClaudeMCP] Force refreshing credentials for profile: ${this.profile}`);
        this.awsCredentials = null; // Clear cache
      } else {
        console.log(`[ClaudeMCP] Cache expired, fetching fresh credentials for profile: ${this.profile}`);
      }

      // Log AWS config file timestamps BEFORE fetch
      console.log(`\n[DEBUG] AWS Config File Status BEFORE fetch:`);
      this.logAWSConfigTimestamps();

      // STRICT ENVIRONMENT PURGE: Create minimal env with ONLY PATH, HOME, USER
      // Absolutely NO AWS_ variables can leak from parent process
      // This prevents the AWS CLI from inheriting stale credentials
      const minimalEnv: Record<string, string> = {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        USER: process.env.USER || '',
      };

      console.log(`\n[DEBUG] Minimal Environment for Credential Fetch:`);
      console.log(`[DEBUG]   Keys: ${Object.keys(minimalEnv).join(', ')}`);
      console.log(`[DEBUG]   PATH length: ${minimalEnv.PATH.length}`);

      console.log(`[ClaudeMCP] Fetching credentials with STRICT minimal env (zero AWS vars inherited)`);

      // 3. EXECUTION ENVIRONMENT TRACE: Log environment object being passed
      console.log(`\n[FORENSIC] MINIMAL_ENV: {`);
      Object.keys(minimalEnv).forEach(key => {
        const value = minimalEnv[key];
        if (key === 'PATH') {
          console.log(`[FORENSIC]   ${key}: [${value.length} chars]`);
        } else {
          console.log(`[FORENSIC]   ${key}: ${value}`);
        }
      });
      console.log('[FORENSIC] }');

      // Log binary path and CLI version
      try {
        const pathInChild = execSync('which aws', { encoding: 'utf-8', env: minimalEnv }).trim();
        console.log('[FORENSIC] BINARY_PATH:', pathInChild);
      } catch (envError: any) {
        console.log('[FORENSIC] BINARY_PATH: ERROR -', envError.message);
      }

      try {
        const versionInChild = execSync('aws --version', { encoding: 'utf-8', env: minimalEnv }).trim();
        console.log('[FORENSIC] CLI_VERSION:', versionInChild);
      } catch (envError: any) {
        console.log('[FORENSIC] CLI_VERSION: ERROR -', envError.message);
      }

      // FIXED: Read credentials with proper fallback order:
      // 1. Try profile as-is in ~/.aws/credentials (e.g., "dev-ah")
      // 2. Fall back to environment variables (AWS_ACCESS_KEY_ID, etc.)
      // 3. Error if neither found
      console.log(`[DEBUG] Reading credentials for profile: ${this.profile}`);

      const homeDir = process.env.HOME || '';
      const credentialsPath = `${homeDir}/.aws/credentials`;

      let id: string | undefined;
      let secret: string | undefined;
      let token: string | undefined;
      let credentialSource = '';

      // Strategy 1: Read from ~/.aws/credentials file
      try {
        const credentialsFile = readFileSync(credentialsPath, 'utf-8');
        const credentials = parseIni(credentialsFile);

        if (credentials[this.profile]) {
          console.log(`[DEBUG] ✅ Found credentials in ~/.aws/credentials for profile: ${this.profile}`);
          const profileCreds = credentials[this.profile];
          id = profileCreds.aws_access_key_id;
          secret = profileCreds.aws_secret_access_key;
          token = profileCreds.aws_session_token;
          credentialSource = `file:${this.profile}`;
        } else {
          console.log(`[DEBUG] Profile ${this.profile} not found in ~/.aws/credentials`);
        }
      } catch (readError: any) {
        console.log(`[DEBUG] Failed to read credentials file: ${readError.message}`);
      }

      // Strategy 2: Fall back to environment variables
      if (!id || !secret) {
        console.log(`[DEBUG] Checking environment variables for credentials`);
        const envAccessKey = process.env.AWS_ACCESS_KEY_ID;
        const envSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
        const envSessionToken = process.env.AWS_SESSION_TOKEN;

        if (envAccessKey && envSecretKey) {
          console.log(`[DEBUG] ✅ Found credentials in environment variables`);
          id = envAccessKey;
          secret = envSecretKey;
          token = envSessionToken;
          credentialSource = 'environment';
        }
      }

      // Validate that we found credentials
      if (!id || !secret) {
        throw new Error(
          `Failed to find credentials for profile ${this.profile}. ` +
          `Checked: ~/.aws/credentials[${this.profile}] and environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).`
        );
      }

      console.log(`[DEBUG] Successfully read credentials from ${credentialSource}`);
      console.log(`[DEBUG] Credentials file path: ${credentialsPath}`);

      // 2. CREDENTIAL METADATA: Log credential state with exact format
      console.log('[FORENSIC] CRED_STATE:', {
        Type: id.startsWith('AKIA') ? 'STATIC' : 'TEMP',
        Prefix: id.substring(0, 5),
        TokenLen: token?.length || 0,
        SecretLen: secret.length,
        AccessKeyLen: id.length,
        Source: credentialSource
      });

      console.log(`\n[DEBUG] Profile Credential Metadata:`);
      this.logCredentialMetadata(id, secret, token);

      this.awsCredentials = {
        accessKeyId: id,
        secretAccessKey: secret,
        sessionToken: token,
      };

      this.lastCredentialFetch = now;

      // Log AWS config file timestamps AFTER fetch
      console.log(`\n[DEBUG] AWS Config File Status AFTER fetch:`);
      this.logAWSConfigTimestamps();

      // Validate credentials with a quick sts call
      console.log(`\n[DEBUG] Validating credentials...`);
      this.validateCredentials();

      console.log(`[ClaudeMCP] Successfully fetched and validated credentials for profile: ${this.profile}`);
      console.log(`[ClaudeMCP] Credentials: Access Key ${this.awsCredentials.accessKeyId.substring(0, 8)}..., Has Session Token: ${!!this.awsCredentials.sessionToken}`);
      console.log(`============ [FORENSIC] getAWSCredentials END (success) ============\n`);
    } catch (error: any) {
      // 4. FAILURE DEEP-DIVE: Capture full stderr/stdout without truncation
      console.log(`\n============ [FORENSIC] getAWSCredentials ERROR ============`);
      console.log('[FORENSIC] SYSTEM_TIME_ISO:', new Date().toISOString());
      console.log('[FORENSIC] ERROR_TYPE:', error.constructor.name);
      console.log('[FORENSIC] ERROR_MESSAGE:', error.message);
      console.log('[FORENSIC] EXIT_CODE:', error.status || 'N/A');

      // Log FULL stdout without truncation
      console.log('[FORENSIC] FULL_STDOUT (', (error.stdout?.length || 0), ' chars):');
      console.log(error.stdout || '(empty)');

      // Log FULL stderr without truncation
      console.log('[FORENSIC] FULL_STDERR (', (error.stderr?.length || 0), ' chars):');
      console.log(error.stderr || '(empty)');

      // Attempt diagnostic STS identity check with minimal env
      const minimalEnv: Record<string, string> = {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        USER: process.env.USER || '',
      };

      // Log environment state in error handler
      console.log('\n[FORENSIC] ERROR_HANDLER_ENV_CHECK:');
      console.log('[FORENSIC] GLOBAL_PROCESS_KEYS:', Object.keys(process.env).filter(k => k.startsWith('AWS')));

      // Check CLI version in error state
      try {
        const awsVersion = execSync('aws --version', { env: minimalEnv, encoding: 'utf-8' }).trim();
        console.log('[FORENSIC] CLI_VERSION_ON_ERROR:', awsVersion);
      } catch (e: any) {
        console.log('[FORENSIC] CLI_VERSION_ON_ERROR: ERROR -', e.message);
      }

      // Attempt STS identity check
      const stsCheckCmd = 'aws sts get-caller-identity';
      console.log('[FORENSIC] RAW_COMMAND:', stsCheckCmd);
      try {
        const stsCheck = execSync(stsCheckCmd, { env: minimalEnv, encoding: 'utf-8' });
        console.log('[FORENSIC] STS_CHECK_SUCCESS:', stsCheck.trim());
      } catch (stsError: any) {
        console.log('[FORENSIC] STS_CHECK_FAILED');
        console.log('[FORENSIC] STS_ERROR_MESSAGE:', stsError.message);
        console.log('[FORENSIC] STS_FULL_STDOUT (', (stsError.stdout?.length || 0), ' chars):');
        console.log(stsError.stdout || '(empty)');
        console.log('[FORENSIC] STS_FULL_STDERR (', (stsError.stderr?.length || 0), ' chars):');
        console.log(stsError.stderr || '(empty)');
      }

      this.awsCredentials = null; // Clear cache on error
      this.lastCredentialFetch = 0;

      const errorMessage = error.stderr || error.message || 'Unknown error';
      console.error(`[ClaudeMCP] Failed to get credentials:`, errorMessage);

      console.log(`============ [FORENSIC] getAWSCredentials END (error) ============\n`);

      // Check for specific error types
      if (errorMessage.includes('ExpiredToken') || errorMessage.includes('expired')) {
        throw new Error(`AWS credentials are expired for profile ${this.profile}. Please refresh your session (e.g., run 'wfo' or 'aws sso login --profile ${this.profile}')`);
      } else if (errorMessage.includes('InvalidClientTokenId')) {
        throw new Error(`AWS credentials are invalid for profile ${this.profile}. Please check your AWS configuration.`);
      } else {
        throw new Error(`Failed to get AWS credentials for profile ${this.profile}: ${errorMessage}`);
      }
    }
  }

  /**
   * Validate that credentials are not expired by making a test call
   * Uses strict minimal environment to prevent credential pollution
   * NEVER assigns credentials to process.env
   */
  private validateCredentials(): void {
    console.log(`\n============ [FORENSIC] validateCredentials START ============`);
    console.log('[FORENSIC] SYSTEM_TIME_ISO:', new Date().toISOString());

    // 1. GLOBAL PROCESS AUDIT
    console.log('[FORENSIC] GLOBAL_PROCESS_KEYS:', Object.keys(process.env).filter(k => k.startsWith('AWS_')));

    if (!this.awsCredentials) {
      throw new Error('No credentials to validate');
    }

    // 2. CREDENTIAL METADATA
    const id = this.awsCredentials.accessKeyId;
    const token = this.awsCredentials.sessionToken;
    console.log('[FORENSIC] CRED_STATE:', {
      Type: id.startsWith('AKIA') ? 'STATIC' : 'TEMP',
      Prefix: id.substring(0, 5),
      TokenLen: token?.length || 0
    });

    try {
      // Use strict minimal environment - credentials only in local env object
      const env: Record<string, string> = {
        AWS_ACCESS_KEY_ID: this.awsCredentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: this.awsCredentials.secretAccessKey,
        AWS_REGION: this.region,
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        USER: process.env.USER || '',
      };

      // Only add session token if it exists
      if (this.awsCredentials.sessionToken) {
        env.AWS_SESSION_TOKEN = this.awsCredentials.sessionToken;
      }

      // 3. EXECUTION ENVIRONMENT TRACE: Log the environment object with masking
      console.log('\n[FORENSIC] VALIDATION_ENV: {');
      Object.keys(env).forEach(key => {
        const value = env[key];
        if (key.includes('KEY') || key.includes('SECRET') || key.includes('TOKEN')) {
          const prefix = value.substring(0, 5);
          const suffix = value.substring(value.length - 5);
          console.log(`[FORENSIC]   ${key}: ${prefix}...${suffix} (length=${value.length})`);
        } else if (key === 'PATH') {
          console.log(`[FORENSIC]   ${key}: [${value.length} chars]`);
        } else {
          console.log(`[FORENSIC]   ${key}: ${value}`);
        }
      });
      console.log('[FORENSIC] }');

      // Log binary path and CLI version
      try {
        const pathInChild = execSync('which aws', { encoding: 'utf-8', env }).trim();
        console.log('[FORENSIC] BINARY_PATH:', pathInChild);
      } catch (envError: any) {
        console.log('[FORENSIC] BINARY_PATH: ERROR -', envError.message);
      }

      try {
        const versionInChild = execSync('aws --version', { encoding: 'utf-8', env }).trim();
        console.log('[FORENSIC] CLI_VERSION:', versionInChild);
      } catch (envError: any) {
        console.log('[FORENSIC] CLI_VERSION: ERROR -', envError.message);
      }

      // 5. COMMAND SANITIZATION: Log the raw command string
      const validationCommand = 'aws sts get-caller-identity';
      console.log('[FORENSIC] RAW_COMMAND:', validationCommand);
      console.log(`[DEBUG] Executing validation command: ${validationCommand}`);

      // Quick test call to verify credentials work
      const result = execSync(validationCommand, {
        encoding: 'utf-8',
        env,
        stdio: ['pipe', 'pipe', 'pipe'], // Suppress output
      });

      console.log('[FORENSIC] VALIDATION_STATUS: SUCCESS');
      console.log('[FORENSIC] RESPONSE_LENGTH:', result.length);
      console.log(`[ClaudeMCP] Credentials validated successfully`);
      console.log(`============ [FORENSIC] validateCredentials END (success) ============\n`);
    } catch (error: any) {
      // 4. FAILURE DEEP-DIVE: Capture full stderr/stdout without truncation
      console.log(`\n============ [FORENSIC] validateCredentials ERROR ============`);
      console.log('[FORENSIC] SYSTEM_TIME_ISO:', new Date().toISOString());
      console.log('[FORENSIC] VALIDATION_STATUS: FAILED');
      console.log('[FORENSIC] ERROR_TYPE:', error.constructor.name);
      console.log('[FORENSIC] ERROR_MESSAGE:', error.message);
      console.log('[FORENSIC] EXIT_CODE:', error.status || 'N/A');

      // Log FULL stdout without truncation
      console.log('[FORENSIC] FULL_STDOUT (', (error.stdout?.length || 0), ' chars):');
      console.log(error.stdout || '(empty)');

      // Log FULL stderr without truncation
      console.log('[FORENSIC] FULL_STDERR (', (error.stderr?.length || 0), ' chars):');
      console.log(error.stderr || '(empty)');

      const errorMessage = error.stderr || error.message || 'Unknown error';
      const errorString = String(errorMessage);

      console.log(`============ [FORENSIC] validateCredentials END (error) ============\n`);

      // Check for botocore loop
      if (errorString.includes('refreshed credentials are still expired')) {
        throw new Error('Botocore credential loop detected during validation');
      }

      // Throw specific error based on AWS error type
      if (errorString.includes('ExpiredToken')) {
        throw new Error('Credentials are expired');
      } else if (errorString.includes('InvalidClientTokenId')) {
        throw new Error('Credentials are invalid');
      } else {
        throw new Error(`Credential validation failed: ${errorString}`);
      }
    }
  }

  /**
   * Execute an AWS CLI command and return the result
   * Credentials are passed via environment variables, not --profile flag
   * Automatically retries once with fresh credentials if ExpiredToken error occurs
   * Detects botocore credential refresh loops and clears AWS CLI cache
   *
   * CRITICAL FIX: Fetches fresh credentials before EACH command execution
   * This prevents credential expiration during multi-step agentic loops
   */
  private executeAWSCommand(command: string, retryCount: number = 0): string {
    console.log(`\n============ [FORENSIC] executeAWSCommand START ============`);

    try {
      // CRITICAL: Fetch fresh credentials before EACH AWS command
      // This ensures we don't use expired credentials during long agentic loops
      this.getAWSCredentials();

      if (!this.awsCredentials) {
        throw new Error('No AWS credentials available after fetch attempt');
      }

      // 1. GLOBAL PROCESS AUDIT: Log every key in process.env that starts with AWS_
      console.log('[FORENSIC] GLOBAL_PROCESS_KEYS:', Object.keys(process.env).filter(k => k.startsWith('AWS_')));
      console.log('[FORENSIC] SYSTEM_TIME_ISO:', new Date().toISOString());

      // 2. CREDENTIAL METADATA: Log prefix and lengths
      const id = this.awsCredentials.accessKeyId;
      const secret = this.awsCredentials.secretAccessKey;
      const token = this.awsCredentials.sessionToken;

      console.log('[FORENSIC] CRED_STATE:', {
        Type: id.startsWith('AKIA') ? 'STATIC' : 'TEMP',
        Prefix: id.substring(0, 5),
        TokenLen: token?.length || 0,
        SecretLen: secret.length,
        AccessKeyLen: id.length
      });

      // Build execution environment with fresh credentials
      const env = {
        ...process.env,
        AWS_ACCESS_KEY_ID: this.awsCredentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: this.awsCredentials.secretAccessKey,
        AWS_SESSION_TOKEN: this.awsCredentials.sessionToken || '',
        AWS_REGION: this.region,
        AWS_DEFAULT_REGION: this.region
      };

      // 3. EXECUTION ENVIRONMENT TRACE: Log environment object (masking secrets)
      console.log('[FORENSIC] EXECUTION_ENV: {');
      Object.keys(env).forEach(key => {
        const value = env[key];
        if (key.includes('KEY') || key.includes('SECRET') || key.includes('TOKEN')) {
          if (value && value.length > 0) {
            const prefix = value.substring(0, 5);
            const suffix = value.substring(value.length - 5);
            console.log(`[FORENSIC]   ${key}: ${prefix}...${suffix} (length=${value.length})`);
          } else {
            console.log(`[FORENSIC]   ${key}: (empty)`);
          }
        } else if (key === 'PATH') {
          console.log(`[FORENSIC]   ${key}: [${value?.length || 0} chars]`);
        } else {
          console.log(`[FORENSIC]   ${key}: ${value || '(empty)'}`);
        }
      });
      console.log('[FORENSIC] }');

      // Log binary path and CLI version
      try {
        const binaryPath = execSync('which aws', { encoding: 'utf-8', env }).trim();
        console.log('[FORENSIC] BINARY_PATH:', binaryPath);
      } catch (e: any) {
        console.log('[FORENSIC] BINARY_PATH: ERROR -', e.message);
      }

      try {
        const cliVersion = execSync('aws --version', { encoding: 'utf-8', env }).trim();
        console.log('[FORENSIC] CLI_VERSION:', cliVersion);
      } catch (e: any) {
        console.log('[FORENSIC] CLI_VERSION: ERROR -', e.message);
      }

      // 5. COMMAND SANITIZATION: Log the raw command string
      console.log('[FORENSIC] RAW_COMMAND:', command);

      // Execute the command
      const stdout = execSync(command, { env, encoding: 'utf-8', stdio: 'pipe' });

      console.log('[FORENSIC] EXECUTION_STATUS: SUCCESS');
      console.log('[FORENSIC] STDOUT_LENGTH:', stdout.length);
      console.log(`============ [FORENSIC] executeAWSCommand END (success) ============\n`);

      return stdout;

    } catch (error: any) {
      // 4. FAILURE DEEP-DIVE: Capture full stderr/stdout without truncation
      console.log(`\n============ [FORENSIC] executeAWSCommand ERROR ============`);
      console.log('[FORENSIC] SYSTEM_TIME_ISO:', new Date().toISOString());
      console.log('[FORENSIC] EXECUTION_STATUS: FAILED');
      console.log('[FORENSIC] ERROR_TYPE:', error.constructor.name);
      console.log('[FORENSIC] ERROR_MESSAGE:', error.message);
      console.log('[FORENSIC] EXIT_CODE:', error.status || 'N/A');

      // Log FULL stdout without truncation
      console.log('[FORENSIC] FULL_STDOUT (', (error.stdout?.length || 0), ' chars):');
      console.log(error.stdout || '(empty)');

      // Log FULL stderr without truncation
      console.log('[FORENSIC] FULL_STDERR (', (error.stderr?.length || 0), ' chars):');
      console.log(error.stderr || '(empty)');

      // Re-check CLI version in error state
      try {
        const version = execSync('aws --version', { encoding: 'utf-8' }).trim();
        console.log('[FORENSIC] CLI_VERSION_ON_ERROR:', version);
      } catch (e: any) {
        console.log('[FORENSIC] CLI_VERSION_ON_ERROR: ERROR -', e.message);
      }

      const errorMessage = error.stderr || error.message || 'Unknown error';
      const errorString = String(errorMessage);

      // CRITICAL: Check for credential errors and retry with fresh credentials
      const isCredentialError =
        errorString.includes('ExpiredToken') ||
        errorString.includes('InvalidClientTokenId') ||
        errorString.includes('UnrecognizedClientException') ||
        errorString.includes('RequestExpired') ||
        errorString.includes('expired') ||
        errorString.includes('refreshed credentials are still expired');

      if (isCredentialError && retryCount < 1) {
        console.log(`[ClaudeMCP] Credential error detected, forcing refresh and retrying (attempt ${retryCount + 1})...`);
        console.log(`[ClaudeMCP] Error was: ${errorString.substring(0, 200)}`);

        // Force credential refresh
        this.getAWSCredentials(true);

        // Retry the command
        console.log(`============ [FORENSIC] executeAWSCommand END (retrying) ============\n`);
        return this.executeAWSCommand(command, retryCount + 1);
      }

      console.log(`============ [FORENSIC] executeAWSCommand END (error) ============\n`);

      // Provide helpful error messages
      if (isCredentialError) {
        throw new Error(`AWS credential error: ${errorString}. Command failed after retry.`);
      }

      throw error;
    }
  }

  /**
   * Execute a Claude CLI query with timeout support
   * Default timeout is 60 seconds to prevent indefinite hangs
   */
  async query(prompt: string, timeoutMs: number = 60000): Promise<ClaudeResponse> {
    return this.queryWithTimeout(prompt, timeoutMs);
  }

  /**
   * Execute a streaming Claude query via Bedrock
   * Yields text chunks as they arrive from Bedrock in real-time
   * Returns an async generator that emits { type, content } objects
   */
  async *queryStream(prompt: string): AsyncGenerator<{ type: string; content?: string; error?: string }, void, unknown> {
    console.log(`[ClaudeMCP] Starting streaming query`);

    try {
      // Ensure we have credentials
      this.getAWSCredentials();

      if (!this.awsCredentials) {
        throw new Error('No AWS credentials available');
      }

      console.log(`[ClaudeMCP] Executing streaming Claude API with profile=${this.profile}, region=${this.region}`);
      console.log(`[ClaudeMCP] Prompt length: ${prompt.length} chars`);

      // Create Bedrock Runtime client with explicit credentials
      const client = new BedrockRuntimeClient({
        region: this.region,
        credentials: {
          accessKeyId: this.awsCredentials.accessKeyId,
          secretAccessKey: this.awsCredentials.secretAccessKey,
          sessionToken: this.awsCredentials.sessionToken,
        },
      });

      // Define aws-mcp tools
      const tools: Tool[] = [
        {
          toolSpec: {
            name: 'call_aws',
            description:
              'Execute AWS CLI commands with validation and proper error handling. Use this tool when you need to run AWS CLI commands to query or manage AWS resources. DO NOT include --profile flag as credentials are automatically provided via environment variables.',
            inputSchema: {
              json: {
                type: 'object',
                properties: {
                  cli_command: {
                    type: 'string',
                    description: 'The complete AWS CLI command to execute. MUST start with "aws". Do NOT include --profile flag.',
                  },
                },
                required: ['cli_command'],
              },
            },
          },
        },
      ];

      // Add system context with current date for accurate date-based queries
      const now = new Date();
      // Format date without timezone conversion to prevent date shifting
      const currentDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const systemContext = `IMPORTANT CONTEXT:
- Current date: ${currentDateStr}
- Current year: ${now.getFullYear()}
- Current month: ${now.getMonth() + 1}
- When querying AWS Cost Explorer or any date-based service, ALWAYS use this current date as reference
- NEVER use hardcoded years or months - calculate all dates dynamically from the current date above`;

      let messages: Message[] = [
        {
          role: 'user',
          content: [
            { text: systemContext },
            { text: '\n\n' },
            { text: prompt }
          ],
        },
      ];

      const maxIterations = 10;
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;
        console.log(`[ClaudeMCP] ========================================`);
        console.log(`[ClaudeMCP] *** ITERATION ${iteration}/${maxIterations}`);
        console.log(`[ClaudeMCP] *** Conversation has ${messages.length} messages`);
        console.log(`[ClaudeMCP] *** Making Bedrock API call...`);

        const command = new ConverseStreamCommand({
          modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          messages,
          toolConfig: {
            tools,
          },
          inferenceConfig: {
            maxTokens: 8192,
            temperature: 0.7,
          },
        });

        console.log(`[ClaudeMCP] *** Sending ConverseStreamCommand to Bedrock...`);
        const response = await client.send(command);
        console.log(`[ClaudeMCP] *** Received response from Bedrock, starting to process stream...`);

        if (!response.stream) {
          console.error(`[ClaudeMCP] No stream in response`);
          throw new Error('No stream returned from Bedrock');
        }

        let stopReason: string | undefined;
        let currentToolUses: Array<{
          toolUseId: string;
          name: string;
          input: any;
          inputJsonString: string; // Accumulate JSON string chunks
        }> = [];
        let assistantContent: ContentBlock[] = [];
        let textChunkCount = 0;
        let toolChunkCount = 0;

        // Process the stream
        console.log(`[ClaudeMCP] Processing stream chunks...`);
        try {
          for await (const chunk of response.stream) {
            if (!chunk) continue;

            console.log(`[ClaudeMCP] Received chunk type: ${Object.keys(chunk).join(', ')}`);

            // Handle content block delta (streaming text)
            if (chunk.contentBlockDelta?.delta) {
              const delta = chunk.contentBlockDelta.delta;
              if ('text' in delta && delta.text) {
                textChunkCount++;
                console.log(`[ClaudeMCP] Text chunk #${textChunkCount}: "${delta.text.substring(0, 80)}${delta.text.length > 80 ? '...' : ''}"`);
                yield {
                  type: 'text',
                  content: delta.text,
                };
              }
            }

            // Handle content block start (tool use starts)
            if (chunk.contentBlockStart?.start) {
              const start = chunk.contentBlockStart.start;
              if ('toolUse' in start && start.toolUse) {
                const toolUse = start.toolUse;
                console.log(`[ClaudeMCP] *** Tool use STARTED: ${toolUse.name}, toolUseId: ${toolUse.toolUseId}`);
                yield {
                  type: 'tool_start',
                  content: toolUse.name,
                };
                currentToolUses.push({
                  toolUseId: toolUse.toolUseId || '',
                  name: toolUse.name || '',
                  input: {},
                  inputJsonString: '', // Initialize empty string for accumulation
                });
              }
            }

            // Handle tool input delta - ACCUMULATE AS STRING, DON'T PARSE YET
            if (chunk.contentBlockDelta?.delta && 'toolUse' in chunk.contentBlockDelta.delta) {
              const toolDelta = chunk.contentBlockDelta.delta.toolUse;
              if (toolDelta?.input && currentToolUses.length > 0) {
                const currentTool = currentToolUses[currentToolUses.length - 1];
                toolChunkCount++;
                console.log(`[ClaudeMCP] Tool input chunk #${toolChunkCount}: "${toolDelta.input}"`);
                // Accumulate tool input as string - JSON may be split across chunks
                currentTool.inputJsonString += toolDelta.input;
              }
            }

            // Handle content block stop (tool use complete)
            if (chunk.contentBlockStop) {
              console.log(`[ClaudeMCP] *** Content block STOPPED`);
              // Parse accumulated tool input JSON now that it's complete
              if (currentToolUses.length > 0) {
                const currentTool = currentToolUses[currentToolUses.length - 1];
                if (currentTool.inputJsonString) {
                  try {
                    currentTool.input = JSON.parse(currentTool.inputJsonString);
                    console.log(`[ClaudeMCP] Successfully parsed tool input:`, JSON.stringify(currentTool.input));
                  } catch (parseError: any) {
                    console.error(`[ClaudeMCP] CRITICAL: Failed to parse tool input JSON:`, currentTool.inputJsonString);
                    console.error(`[ClaudeMCP] Parse error:`, parseError.message);
                    throw new Error(`Failed to parse tool input: ${parseError.message}`);
                  }
                }
              }
            }

            // Handle message stop
            if (chunk.messageStop) {
              stopReason = chunk.messageStop.stopReason;
              console.log(`[ClaudeMCP] *** Message STOPPED, reason: ${stopReason}`);
              console.log(`[ClaudeMCP] *** Stream stats: ${textChunkCount} text chunks, ${toolChunkCount} tool input chunks`);
            }

            // Handle metadata
            if (chunk.metadata) {
              console.log(`[ClaudeMCP] Stream metadata:`, JSON.stringify(chunk.metadata));
            }
          }

          console.log(`[ClaudeMCP] *** Stream iteration complete, final stop_reason: ${stopReason}`);
        } catch (streamError: any) {
          console.error(`[ClaudeMCP] CRITICAL: Error while processing stream:`, streamError.message);
          console.error(`[ClaudeMCP] Stream error stack:`, streamError.stack);
          throw streamError;
        }

        console.log(`[ClaudeMCP] ====== Stream iteration ${iteration} complete, stop_reason: ${stopReason} ======`);

        // Handle tool use - this is the critical multi-turn flow
        if (stopReason === 'tool_use') {
          console.log(`[ClaudeMCP] *** TOOL USE DETECTED - Processing ${currentToolUses.length} tool calls`);

          const toolResultBlocks: ContentBlock[] = [];

          for (let i = 0; i < currentToolUses.length; i++) {
            const toolUse = currentToolUses[i];
            console.log(`[ClaudeMCP] *** Executing tool ${i + 1}/${currentToolUses.length}: ${toolUse.name}`);
            console.log(`[ClaudeMCP] *** Tool input:`, JSON.stringify(toolUse.input));

            if (toolUse.name === 'call_aws') {
              const input = toolUse.input as { cli_command: string };

              if (!input.cli_command) {
                console.error(`[ClaudeMCP] CRITICAL: Tool call missing cli_command parameter`);
                toolResultBlocks.push({
                  toolResult: {
                    toolUseId: toolUse.toolUseId,
                    content: [{ text: 'Error: cli_command parameter is required' }],
                    status: 'error',
                  },
                } as ContentBlock);
                yield {
                  type: 'tool_error',
                  content: 'Missing cli_command parameter',
                };
                continue;
              }

              console.log(`[ClaudeMCP] *** Executing AWS command: ${input.cli_command}`);

              yield {
                type: 'tool_execute',
                content: input.cli_command,
              };

              try {
                const result = this.executeAWSCommand(input.cli_command);
                console.log(`[ClaudeMCP] *** Tool execution SUCCESS`);
                console.log(`[ClaudeMCP] *** Result length: ${result.length} chars`);
                console.log(`[ClaudeMCP] *** Result preview: ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`);

                toolResultBlocks.push({
                  toolResult: {
                    toolUseId: toolUse.toolUseId,
                    content: [{ text: result }],
                  },
                } as ContentBlock);

                yield {
                  type: 'tool_complete',
                  content: toolUse.name,
                };
              } catch (error: any) {
                const errorMessage = error.message || String(error);
                console.error(`[ClaudeMCP] *** Tool execution FAILED: ${errorMessage}`);
                console.error(`[ClaudeMCP] *** Error stack:`, error.stack);

                // Check for credential errors
                if (
                  errorMessage.includes('ExpiredToken') ||
                  errorMessage.includes('InvalidClientTokenId') ||
                  errorMessage.includes('UnrecognizedClientException') ||
                  errorMessage.includes('RequestExpired') ||
                  errorMessage.includes('credential')
                ) {
                  console.error(`[ClaudeMCP] CRITICAL: Credential failure in tool execution`);
                  throw new Error(`AWS credential failure during tool execution: ${errorMessage}`);
                }

                // For non-credential errors, send error as tool result so Claude can respond gracefully
                console.log(`[ClaudeMCP] *** Sending error as tool result to allow Claude to handle gracefully`);
                toolResultBlocks.push({
                  toolResult: {
                    toolUseId: toolUse.toolUseId,
                    content: [{ text: `Error: ${errorMessage}` }],
                    status: 'error',
                  },
                } as ContentBlock);

                yield {
                  type: 'tool_error',
                  content: errorMessage,
                };
              }
            }
          }

          // Build assistant message from tool uses
          console.log(`[ClaudeMCP] *** Building assistant message with ${currentToolUses.length} tool use blocks`);
          for (const toolUse of currentToolUses) {
            assistantContent.push({
              toolUse: {
                toolUseId: toolUse.toolUseId,
                name: toolUse.name,
                input: toolUse.input,
              },
            });
          }

          // Add assistant's message to conversation
          messages.push({
            role: 'assistant',
            content: assistantContent,
          });
          console.log(`[ClaudeMCP] *** Added assistant message with tool uses to conversation`);

          // Add tool results as user message
          messages.push({
            role: 'user',
            content: toolResultBlocks,
          });
          console.log(`[ClaudeMCP] *** Added ${toolResultBlocks.length} tool results as user message`);
          console.log(`[ClaudeMCP] *** Total conversation messages: ${messages.length}`);

          // Continue the conversation - THIS IS CRITICAL
          // This will trigger another API call where Claude processes the tool results
          // and streams the final response
          console.log(`[ClaudeMCP] *** CONTINUING conversation for iteration ${iteration + 1} to get Claude's final response...`);
          console.log(`[ClaudeMCP] *** ========================================`);
          continue;
        }

        // If we get here, Claude has finished with end_turn (not tool_use)
        console.log(`[ClaudeMCP] *** STREAM COMPLETE - stop_reason was "${stopReason}", ending stream`);
        yield {
          type: 'complete',
        };
        return;
      }

      console.error(`[ClaudeMCP] CRITICAL: Exceeded maximum iterations (${maxIterations})`);
      console.error(`[ClaudeMCP] This suggests an infinite tool use loop or the model not reaching end_turn`);
      throw new Error(`Exceeded maximum iterations (${maxIterations}). The conversation may be stuck in a tool use loop.`);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      const errorName = error.name || 'UnknownError';

      console.error(`[ClaudeMCP] ========================================`);
      console.error(`[ClaudeMCP] *** CRITICAL ERROR in queryStream ***`);
      console.error(`[ClaudeMCP] Error name: ${errorName}`);
      console.error(`[ClaudeMCP] Error message: ${errorMessage}`);
      if (error.stack) {
        console.error(`[ClaudeMCP] Error stack:`, error.stack);
      }
      if (error.$metadata) {
        console.error(`[ClaudeMCP] AWS Error metadata:`, JSON.stringify(error.$metadata));
      }
      console.error(`[ClaudeMCP] ========================================`);

      yield {
        type: 'error',
        error: `Claude API streaming failed [${errorName}]: ${errorMessage}`,
      };
    }
  }

  /**
   * Execute query with timeout wrapper
   */
  private async queryWithTimeout(prompt: string, timeoutMs: number): Promise<ClaudeResponse> {
    console.log(`[ClaudeMCP] Starting query with ${timeoutMs}ms timeout`);
    return Promise.race([
      this.executeQuery(prompt),
      new Promise<ClaudeResponse>((_, reject) =>
        setTimeout(() => {
          console.error(`[ClaudeMCP] Query timed out after ${timeoutMs}ms`);
          reject(new Error(`Claude API request timed out after ${timeoutMs / 1000} seconds. Please try again with a simpler query.`));
        }, timeoutMs)
      ),
    ]);
  }

  /**
   * Execute a Claude API query using AWS Bedrock Runtime
   * Automatically retries once with fresh credentials if ExpiredToken error occurs
   */
  private async executeQuery(prompt: string, retryCount: number = 0): Promise<ClaudeResponse> {
    const MAX_RETRIES = 1;

    try {
      // Ensure we have credentials before making API calls
      this.getAWSCredentials();

      if (!this.awsCredentials) {
        throw new Error('No AWS credentials available');
      }

      if (retryCount === 0) {
        console.log(`[ClaudeMCP] Executing Claude API with profile=${this.profile}, region=${this.region}`);
        console.log(`[ClaudeMCP] Prompt length: ${prompt.length} chars`);
      } else {
        console.log(`[ClaudeMCP] Retrying Claude API (attempt ${retryCount + 1})`);
      }

      // Create Bedrock Runtime client with explicit credentials
      const client = new BedrockRuntimeClient({
        region: this.region,
        credentials: {
          accessKeyId: this.awsCredentials.accessKeyId,
          secretAccessKey: this.awsCredentials.secretAccessKey,
          sessionToken: this.awsCredentials.sessionToken,
        },
      });

      // Define aws-mcp tools for Bedrock
      const tools: Tool[] = [
        {
          toolSpec: {
            name: 'call_aws',
            description:
              'Execute AWS CLI commands with validation and proper error handling. Use this tool when you need to run AWS CLI commands to query or manage AWS resources. DO NOT include --profile flag as credentials are automatically provided via environment variables.',
            inputSchema: {
              json: {
                type: 'object',
                properties: {
                  cli_command: {
                    type: 'string',
                    description: 'The complete AWS CLI command to execute. MUST start with "aws". Do NOT include --profile flag.',
                  },
                },
                required: ['cli_command'],
              },
            },
          },
        },
      ];

      // Add system context with current date for accurate date-based queries
      const now = new Date();
      // Format date without timezone conversion to prevent date shifting
      const currentDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const systemContext = `IMPORTANT CONTEXT:
- Current date: ${currentDateStr}
- Current year: ${now.getFullYear()}
- Current month: ${now.getMonth() + 1}
- When querying AWS Cost Explorer or any date-based service, ALWAYS use this current date as reference
- NEVER use hardcoded years or months - calculate all dates dynamically from the current date above`;

      let messages: Message[] = [
        {
          role: 'user',
          content: [
            { text: systemContext },
            { text: '\n\n' },
            { text: prompt }
          ],
        },
      ];

      const maxIterations = 10; // Prevent infinite loops
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;

        const command = new ConverseCommand({
          modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          messages,
          toolConfig: {
            tools,
          },
          inferenceConfig: {
            maxTokens: 8192,
            temperature: 0.7,
          },
        });

        const response = await client.send(command);

        console.log(`[ClaudeMCP] API response - stop_reason: ${response.stopReason}`);

        // Handle tool use
        if (response.stopReason === 'tool_use') {
          const output = response.output;
          if (!output || !('message' in output) || !output.message) {
            throw new Error('Invalid response from Bedrock');
          }

          const assistantMessage = output.message;

          // Extract tool use blocks
          const toolUseBlocks = (assistantMessage.content || []).filter(
            (block): block is ContentBlock & { toolUse: NonNullable<ContentBlock['toolUse']> } =>
              'toolUse' in block && block.toolUse !== undefined
          );

          const toolResultBlocks: ContentBlock[] = [];

          for (const block of toolUseBlocks) {
            const toolUse = block.toolUse;
            console.log(`[ClaudeMCP] Tool requested: ${toolUse.name}`);

            if (toolUse.name === 'call_aws') {
              const input = toolUse.input as { cli_command: string };
              console.log(`[ClaudeMCP] Executing: ${input.cli_command}`);

              try {
                const result = this.executeAWSCommand(input.cli_command);
                toolResultBlocks.push({
                  toolResult: {
                    toolUseId: toolUse.toolUseId!,
                    content: [{ text: result }],
                  },
                } as ContentBlock);
              } catch (error: any) {
                const errorMessage = error.message || String(error);

                // CRITICAL: Detect credential failures and propagate them up
                // Don't let credential errors get swallowed as tool errors
                if (
                  errorMessage.includes('ExpiredToken') ||
                  errorMessage.includes('InvalidClientTokenId') ||
                  errorMessage.includes('UnrecognizedClientException') ||
                  errorMessage.includes('RequestExpired') ||
                  errorMessage.includes('credential')
                ) {
                  console.error(`[ClaudeMCP] CRITICAL: Credential failure in tool execution: ${errorMessage}`);
                  // Let the error propagate up to fail the entire query
                  throw new Error(`AWS credential failure during tool execution: ${errorMessage}`);
                }

                // For non-credential errors, return as tool error
                console.error(`[ClaudeMCP] Tool execution error: ${errorMessage}`);
                toolResultBlocks.push({
                  toolResult: {
                    toolUseId: toolUse.toolUseId!,
                    content: [{ text: `Error: ${errorMessage}` }],
                    status: 'error',
                  },
                } as ContentBlock);
              }
            }
          }

          // Add assistant's message to conversation
          messages.push(assistantMessage);

          // Add tool results as user message
          messages.push({
            role: 'user',
            content: toolResultBlocks,
          });

          // Continue the conversation
          continue;
        }

        // If we get here, Claude has finished (stop_reason is 'end_turn' or similar)
        const output = response.output;
        if (!output || !('message' in output) || !output.message) {
          throw new Error('Invalid response from Bedrock');
        }

        const textBlocks = (output.message.content || []).filter(
          (block): block is ContentBlock & { text: string } =>
            'text' in block && typeof block.text === 'string'
        );

        const content = textBlocks.map((block) => block.text).join('\n\n');

        console.log(`[ClaudeMCP] Success`);

        return {
          content: content.trim(),
          raw: JSON.stringify(response, null, 2),
        };
      }

      throw new Error(`Exceeded maximum iterations (${maxIterations})`);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      const errorName = error.name || 'UnknownError';

      // Log detailed error information
      console.error(`[ClaudeMCP] Error [${errorName}]:`, errorMessage);
      if (error.$metadata) {
        console.error(`[ClaudeMCP] AWS Error metadata:`, JSON.stringify(error.$metadata));
      }
      if (error.Code) {
        console.error(`[ClaudeMCP] AWS Error Code:`, error.Code);
      }

      // Retry logic for expired credentials
      if (
        retryCount < MAX_RETRIES &&
        (errorName === 'ExpiredTokenException' ||
          errorName === 'UnrecognizedClientException' ||
          errorMessage.includes('ExpiredToken') ||
          errorMessage.includes('expired'))
      ) {
        console.log(`[ClaudeMCP] Credentials expired, fetching fresh credentials and retrying...`);
        this.getAWSCredentials(true); // Force refresh
        return this.executeQuery(prompt, retryCount + 1); // Retry
      }

      throw new Error(`Claude API failed [${errorName}]: ${errorMessage}`);
    }
  }

  /**
   * Change the AWS profile for subsequent queries
   */
  setProfile(profile: string): void {
    this.profile = profile;
    this.awsCredentials = null; // Clear cached credentials
    console.log(`[ClaudeMCP] Profile changed to: ${profile}`);
  }

  /**
   * Get current profile
   */
  getProfile(): string {
    return this.profile;
  }
}
