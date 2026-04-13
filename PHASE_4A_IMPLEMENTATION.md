# Phase 4A Implementation: Environment Variables vs Secrets Separation

## Overview

Phase 4A implements the fundamental separation between environment variables and secrets during sandbox injection. This phase lays the groundwork for the new `isSecret` field while maintaining backward compatibility with existing projects and sandbox configurations.

## Key Changes

### 1. Updated SandboxManager (`libs/orchestrator/src/lib/sandbox-manager.ts`)

#### Enhanced `buildContainerEnvVars()` method:
- **Before**: `buildContainerEnvVars(): Record<string, string>`
- **After**: `buildContainerEnvVars(projectId?: string, repositoryId?: string): Record<string, string>`

The method now:
- Accepts optional `projectId` and `repositoryId` parameters for context-specific resolution
- Uses the new `getContextSecrets` callback to distinguish between environment variables and secrets
- Directly injects environment variables (`isSecret: false`) into container env
- Uses placeholder values for secrets (`isSecret: true`) that need MITM proxy interception

#### New context update methods:
- `updateContextSecrets(projectId?, repositoryId?)`: Hot-updates secrets configuration for specific contexts
- `getSessionRepositoryId(sandboxId)`: Helper to retrieve repository context for sessions

#### Enhanced `createSandbox()` method:
- Added optional `repositoryId` parameter
- Passes project and repository context to `buildContainerEnvVars()`

### 2. Updated OrchestratorConfig (`libs/orchestrator/src/lib/types.ts`)

#### New `getContextSecrets` callback:
```typescript
getContextSecrets?: (projectId?: string, repositoryId?: string) => {
  envVars: Record<string, string>;  // Direct injection
  secrets: string[];               // MITM proxy placeholders
};
```

This callback enables:
- Synchronous access to async secret resolution (via caching)
- Context-specific secret resolution (global/project/repository)
- Clear separation between direct injection and proxy interception

### 3. Enhanced ProjectsService (`apps/api/src/modules/projects/projects.service.ts`)

#### New caching mechanism:
- `currentSecretPlaceholders`: Stores current secret mappings
- `secretsCache`: Caches resolved secrets by context with TTL
- `SECRETS_CACHE_TTL`: 1-minute cache expiration

#### New methods:
- `getRepositoryIdFromGitUrl(gitRepo)`: Extracts `owner/repo` from GitHub URLs
- `getContextSecrets(projectId?, repositoryId?)`: Synchronous secret resolution with async cache refresh
- `refreshSecretsCache(projectId?, repositoryId?)`: Async background cache refresh using `secretsService.resolveForContext()`
- `clearSecretsCache(projectId?, repositoryId?)`: Cache invalidation for specific contexts
- `updateContextSecretsOnManagers(projectId?, repositoryId?)`: Propagates changes to sandbox managers

#### Enhanced sandbox creation:
- `provisionSandbox()` now extracts repository ID from git URL and passes it to `createSandbox()`

### 4. Updated Secrets Routes (`apps/api/src/modules/secrets/secrets.routes.ts`)

#### Enhanced type definitions:
- Added `isSecret?: boolean` field to create and update interfaces
- Maintains backward compatibility (defaults to `true` for secrets)

#### Cache invalidation hooks:
- POST `/`: Calls `updateContextSecretsOnManagers()` after secret creation
- PUT `/:id`: Calls `updateContextSecretsOnManagers()` after secret updates  
- DELETE `/:id`: Calls `updateContextSecretsOnManagers()` for global cache clear

## Implementation Details

### Environment Variable vs Secret Separation Logic

```typescript
// In getContextSecrets()
for (const secret of resolvedSecrets) {
  if (secret.isSecret) {
    // This is a secret that needs MITM proxy
    secrets.push(secret.name);
  } else {
    // This is an environment variable that gets directly injected
    envVars[secret.name] = secret.value;
  }
}
```

### Context-Specific Resolution Priority

The system uses `secretsService.resolveForContext()` which implements:
- **Repository-scoped** secrets override project-scoped and global
- **Project-scoped** secrets override global  
- **Global** secrets as fallback

### Caching Strategy

- **Synchronous access**: `getContextSecrets()` returns cached values immediately
- **Async refresh**: Background cache refresh using `refreshSecretsCache()`
- **Cache invalidation**: Context-specific invalidation on secret changes
- **TTL**: 1-minute cache expiration for automatic refresh

### Backward Compatibility

- Existing `secretPlaceholders` configuration still works
- Projects without repository context fall back to project/global resolution
- All existing secrets are treated as `isSecret: true` by default
- No breaking changes to existing API interfaces

## Test Results

The Phase 4A test (`test-phase-4a.js`) validates:

✅ **getContextSecrets callback interface**: Properly invoked with project/repository parameters  
✅ **Environment variable injection**: Direct values in container environment  
✅ **Secret placeholders**: Placeholder values for MITM proxy interception  
✅ **Context resolution**: Different behavior for global/project/repository contexts  
✅ **LLM key handling**: Always proxied regardless of context  
✅ **Proxy configuration**: HTTPS_PROXY and SECRET_DOMAINS properly set  

## Example Container Environment

For a repository with mixed environment variables and secrets:

```bash
# Direct environment variable injection
DATABASE_URL=postgresql://localhost/mydb
DEBUG_MODE=true

# Secret placeholders for MITM proxy
API_TOKEN=token-placeholder
STRIPE_KEY=sk-proxy-placeholder

# LLM keys (always proxied)
ANTHROPIC_API_KEY=sk-proxy-placeholder
ANTHROPIC_BASE_URL=http://localhost:3000/llm-proxy/anthropic/v1

# Proxy configuration
HTTPS_PROXY=http://localhost:9339
SECRET_DOMAINS=api.stripe.com
```

## Future Phases

Phase 4A provides the foundation for:

- **Phase 4B**: Repository-specific secret routes and UI management
- **Phase 4C**: Advanced caching and performance optimizations
- **Phase 4D**: Migration tools for existing secrets to use `isSecret` field
- **Phase 5**: Full repository-based secret management with GitHub integration

## Breaking Changes

None. Phase 4A maintains full backward compatibility while preparing the infrastructure for future enhancements.

## Migration Notes

No immediate migration required. The system will:
1. Continue working with existing global/project secrets
2. Treat all existing secrets as `isSecret: true` (MITM proxy)
3. Allow gradual adoption of the new `isSecret` field
4. Support mixed environments with both environment variables and secrets

This implementation successfully achieves the Phase 4A goals of separating environment variables from secrets during container injection while maintaining backward compatibility and preparing for repository-based secret management.