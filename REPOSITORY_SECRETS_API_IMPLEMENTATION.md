# Repository Secrets API Implementation

This document outlines the implementation of the repository-scoped secrets management API endpoints as requested in Phase 3.

## Overview

The implementation adds repository-scoped secrets management to the existing secrets system. Secrets can now be scoped to specific GitHub repositories (in "owner/repo" format), allowing for more granular secret management.

## API Endpoints Added

### Repository Management Endpoints

#### `GET /api/repositories`
- **Purpose**: List all repositories that have secrets configured for the current user
- **Response**: Array of repository information with secret counts
- **Example Response**:
```json
[
  {
    "repositoryId": "owner/repo",
    "secretCount": 3,
    "envVarCount": 2,
    "totalCount": 5
  }
]
```

#### `GET /api/repositories/:repoId/secrets`
- **Purpose**: Get all secrets for a specific repository
- **Parameters**: `repoId` - URL-encoded repository ID (e.g., `owner%2Frepo`)
- **Response**: Array of secrets (values masked) for the specified repository
- **Validation**: Repository ID must follow "owner/repo" format

#### `POST /api/repositories/:repoId/secrets`
- **Purpose**: Create a new secret for a specific repository
- **Parameters**: `repoId` - URL-encoded repository ID
- **Body**:
```json
{
  "name": "SECRET_NAME",
  "value": "secret_value",
  "domain": "api.example.com",
  "authType": "bearer",
  "isSecret": true,
  "description": "Optional description"
}
```
- **Response**: Created secret with masked value
- **Error Handling**: 409 Conflict if secret name already exists for this repository

#### `PUT /api/repositories/:repoId/secrets/:id`
- **Purpose**: Update an existing repository secret
- **Parameters**: 
  - `repoId` - URL-encoded repository ID
  - `id` - Secret ID
- **Body**: Partial update object (same fields as POST)
- **Response**: Updated secret with masked value
- **Security**: Only allows updates to secrets owned by the user in the specified repository

#### `DELETE /api/repositories/:repoId/secrets/:id`
- **Purpose**: Delete a repository secret
- **Parameters**: 
  - `repoId` - URL-encoded repository ID
  - `id` - Secret ID
- **Response**: `{ "ok": true }`
- **Security**: Only allows deletion of secrets owned by the user in the specified repository

### Enhanced Existing Endpoints

#### `GET /api/secrets` (Enhanced)
- **New Parameters**:
  - `scope` - Filter by scope: "global" or "repository"
  - `repositoryId` - When using scope=repository, specify which repository
- **Examples**:
  - `GET /api/secrets?scope=global` - Get only global secrets
  - `GET /api/secrets?scope=repository&repositoryId=owner/repo` - Get only secrets for specific repository
  - `GET /api/secrets` - Get all secrets (existing behavior preserved)

#### `POST /api/secrets` (Enhanced)
- **New Body Fields**:
  - `repositoryId` - Optional repository ID to scope the secret
- **Validation**: Repository ID format validation if provided
- **Error Handling**: 409 Conflict with scope-specific error messages

#### `PUT /api/secrets/:id` (Enhanced)
- **New Body Fields**:
  - `repositoryId` - Can move secrets between scopes (global, project, repository)
- **Validation**: Repository ID format validation if provided
- **Error Handling**: 409 Conflict with scope-specific error messages

## Service Methods Added

### SecretsService New Methods

#### `listRepositories(userId: string): Promise<RepositoryInfo[]>`
- Groups secrets by repository ID and returns counts
- Only includes repositories that have at least one secret

#### `listRepositorySecrets(userId: string, repositoryId: string): Promise<SecretListItem[]>`
- Returns all secrets for a specific repository
- Values are excluded from the response for security

#### `createRepositorySecret(userId, repositoryId, input): Promise<SecretRecord>`
- Creates a secret scoped to a specific repository
- Enforces unique constraint within repository scope

#### `updateRepositorySecret(id, userId, repositoryId, updates): Promise<SecretRecord | null>`
- Updates a repository secret with repository scope validation
- Returns null if secret not found or access denied

#### `removeRepositorySecret(id, userId, repositoryId): Promise<boolean>`
- Removes a repository secret with repository scope validation
- Returns false if secret not found or access denied

### Enhanced Existing Methods

#### `list(userId, projectId?, repositoryId?, scope?): Promise<SecretListItem[]>`
- **New Parameter**: `scope` - "global" or "repository"
- Supports filtering by scope for better UI organization

## Validation & Security

### Repository ID Validation
- **Format**: `owner/repo` (e.g., "microsoft/vscode")
- **Pattern**: `/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/`
- **Restrictions**: Cannot start or end with `/`

### Security Features
- **User Scoping**: All operations are scoped to the current user
- **Repository Scoping**: Repository-specific endpoints validate repository ownership
- **Value Masking**: Secret values are masked in all responses using pattern: `first4chars••••last4chars`
- **Unique Constraints**: Secret names must be unique within each scope (global, project, repository)

### Error Handling
- **400 Bad Request**: Invalid repository ID format
- **404 Not Found**: Secret not found or access denied
- **409 Conflict**: Duplicate secret names with scope-specific error messages

## Database Schema

The existing `secrets` table already supports repository scoping:
- `repositoryId: text` - GitHub repository in "owner/repo" format
- Unique constraints prevent duplicate names within the same scope
- Indexes optimize lookups by repository

## Integration Points

### Proxy Restart
- All secret modifications trigger proxy restarts via `restartSecretsProxy()`
- Ensures MITM proxy is updated with new secret domains

### Sandbox Management
- Secret changes trigger sandbox manager reinitialization
- Updates secret domains on all active sandbox managers

## Testing

A comprehensive test suite validates:
- Repository ID validation
- CRUD operations for repository secrets
- Scope isolation between repositories
- Unique constraint enforcement
- Error handling and edge cases
- Integration with existing global/project scoped secrets

## Backward Compatibility

All changes are backward compatible:
- Existing global and project-scoped secrets continue to work
- Existing API endpoints maintain their current behavior
- New query parameters are optional
- Enhanced filtering is additive, not breaking

## Usage Examples

### Create a Repository Secret
```bash
curl -X POST "http://localhost:3000/api/repositories/owner%2Frepo/secrets" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "STRIPE_SECRET_KEY",
    "value": "sk_test_...",
    "domain": "api.stripe.com",
    "authType": "bearer",
    "isSecret": true,
    "description": "Stripe API key for this repository"
  }'
```

### List Repository Secrets
```bash
curl "http://localhost:3000/api/repositories/owner%2Frepo/secrets"
```

### Get All Repositories with Secrets
```bash
curl "http://localhost:3000/api/repositories"
```

### Filter Secrets by Scope
```bash
# Get only global secrets
curl "http://localhost:3000/api/secrets?scope=global"

# Get only repository-specific secrets
curl "http://localhost:3000/api/secrets?scope=repository&repositoryId=owner/repo"
```