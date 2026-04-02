# Port Relay Setup and Configuration

This comprehensive guide covers the installation, configuration, platform-specific setup, and advanced configuration options for the Port Relay feature in Apex. It includes troubleshooting steps, security considerations, and performance tuning guidance for production deployments.

## Table of Contents

- [Installation Requirements](#installation-requirements)
- [Basic Configuration](#basic-configuration)
- [Platform-Specific Setup](#platform-specific-setup)
- [Environment Variables](#environment-variables)
- [Provider Configuration](#provider-configuration)
- [Advanced Configuration](#advanced-configuration)
- [Troubleshooting Setup Issues](#troubleshooting-setup-issues)

## Installation Requirements

### System Requirements

#### Minimum Requirements
- **OS**: macOS 10.15+ (macOS 12+ for Apple Container), Windows 10+ (Windows 11 recommended), or Linux (Ubuntu 18.04+, CentOS 8+)
- **Memory**: 4GB RAM minimum, 8GB+ recommended for multiple concurrent forwards
- **CPU**: Any modern CPU (optimized for multi-core for parallel forwarding operations)
- **Network**: Stable internet connection for cloud sandboxes, local network for Docker/Apple Container
- **Ports**: At least 100 available ports in configurable range (default 8000-9000)
- **Disk**: 50MB free space for configuration and logs

#### Performance Requirements  
- **Concurrent Forwards**: Up to 50 forwards per project, 200+ total forwards tested
- **Connection Throughput**: 100MB/s+ per forward on local providers, 80% of baseline on tunneled
- **Latency Overhead**: <2ms for local providers, <50ms additional for cloud providers
- **Resource Usage**: ~1MB memory + 10KB per connection, <0.1% CPU per idle forward

#### Software Dependencies
- **Node.js**: Version 18.0 or higher
- **Bun**: Version 1.0+ (for desktop app)
- **Docker**: Version 20.0+ (for Docker provider)
- **Git**: Version 2.20+ (for project management)

### Apex Installation

If you haven't already installed Apex:

```bash
# Install Apex CLI
npm install -g @apex/cli

# Or install via package manager (macOS)
brew install apex

# Or download desktop app
# Visit https://apex.sh/download
```

### Verify Installation

Check that Port Relay is available:

```bash
# Check Apex CLI version (should include port relay support)
apex --version

# Check if port relay is enabled
apex config get portRelay.enabled
```

## Basic Configuration

### Initial Setup

1. **Enable Port Relay** (enabled by default):
   ```bash
   apex config set portRelay.enabled true
   ```

2. **Configure port range** (optional):
   ```bash
   apex config set portRelay.portRange.start 8000
   apex config set portRelay.portRange.end 9000
   ```

3. **Set auto-forwarding preference**:
   ```bash
   apex config set portRelay.autoForwardNewPorts true
   ```

### Configuration File

Port Relay settings are stored in your Apex configuration file:

**Location**:
- **macOS**: `~/Library/Application Support/Apex/config.json`
- **Windows**: `%APPDATA%/Apex/config.json`
- **Linux**: `~/.config/apex/config.json`

**Example Configuration**:
```json
{
  "portRelay": {
    "enabled": true,
    "autoForwardNewPorts": true,
    "portRange": {
      "start": 8000,
      "end": 9000
    },
    "excludedPorts": [8080, 8443, 8888, 3001],
    "maxAutoForwards": 10,
    "enableHealthChecks": true,
    "healthCheckInterval": 30000
  }
}
```

## Platform-Specific Setup

### macOS Setup

#### Firewall Configuration

macOS may prompt for firewall permissions when port forwarding starts:

1. **Allow incoming connections** when prompted
2. **Add Apex to firewall exceptions**:
   ```bash
   # Add Apex CLI to firewall allowlist
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which apex)
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp $(which apex)
   ```

#### Network Permissions

Grant network access to Apex:

1. **System Preferences → Security & Privacy → Privacy**
2. **Select "Network" from the left sidebar**
3. **Click the lock to make changes**
4. **Add Apex to the allowed applications list**

#### Apple Container Provider Setup

For Apple Container (Lima) support:

```bash
# Install Lima
brew install lima

# Start default VM
limactl start

# Verify Lima is running
limactl list
```

### Windows Setup

#### Windows Defender Configuration

Add Apex to Windows Defender exclusions:

1. **Open Windows Security**
2. **Go to Virus & threat protection**
3. **Manage settings under "Virus & threat protection settings"**
4. **Add exclusion → Folder**
5. **Add the Apex installation directory**

#### Firewall Configuration

Configure Windows Firewall for port forwarding:

```powershell
# Run as Administrator
# Allow Apex through Windows Firewall
New-NetFirewallRule -DisplayName "Apex Port Relay" -Direction Inbound -Protocol TCP -LocalPort 8000-9000 -Action Allow

# Allow Apex executable
New-NetFirewallRule -DisplayName "Apex CLI" -Direction Inbound -Program "C:\Program Files\Apex\apex.exe" -Action Allow
```

#### Docker Desktop Setup

Ensure Docker Desktop is running with WSL2 backend:

1. **Install Docker Desktop**
2. **Enable WSL2 integration**
3. **Start Docker Desktop**
4. **Verify**: `docker ps`

### Linux Setup

#### Firewall Configuration (UFW)

```bash
# Allow port range for port forwarding
sudo ufw allow 8000:9000/tcp

# Allow Apex CLI
sudo ufw allow from 127.0.0.1

# Reload firewall
sudo ufw reload
```

#### Firewall Configuration (iptables)

```bash
# Allow local port forwarding
sudo iptables -A INPUT -p tcp --dport 8000:9000 -j ACCEPT
sudo iptables -A INPUT -s 127.0.0.1 -j ACCEPT

# Save rules (Ubuntu/Debian)
sudo iptables-save > /etc/iptables/rules.v4
```

#### AppArmor Configuration

If using AppArmor, create a profile for Apex:

```bash
# Create AppArmor profile
sudo tee /etc/apparmor.d/apex << EOF
#include <tunables/global>

/usr/local/bin/apex {
  #include <abstractions/base>
  #include <abstractions/nameservice>
  
  capability net_bind_service,
  capability net_admin,
  
  /usr/local/bin/apex r,
  /home/*/.config/apex/** rw,
  
  network tcp,
  network unix,
}
EOF

# Load profile
sudo apparmor_parser -r /etc/apparmor.d/apex
```

#### Docker Permissions

Add your user to the docker group:

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Restart session (or log out/in)
newgrp docker

# Verify docker access
docker ps
```

## Environment Variables

### Core Variables

```bash
# Enable/disable port relay
export APEX_PORT_RELAY_ENABLED=true

# Set port range
export APEX_PORT_RELAY_START=8000
export APEX_PORT_RELAY_END=9000

# Configure auto-forwarding
export APEX_PORT_RELAY_AUTO_FORWARD=true

# Set maximum auto-forwards
export APEX_PORT_RELAY_MAX_FORWARDS=10
```

### Debug Variables

```bash
# Enable debug logging
export DEBUG=port-relay*

# Set log level
export APEX_LOG_LEVEL=debug

# Enable performance monitoring
export APEX_PORT_RELAY_METRICS=true
```

### Provider-Specific Variables

#### Docker Provider
```bash
# Docker socket path (if non-standard)
export DOCKER_HOST=unix:///var/run/docker.sock

# Docker network for port forwarding
export APEX_DOCKER_NETWORK=bridge
```

#### Daytona Provider
```bash
# Daytona API endpoint
export DAYTONA_API_URL=https://api.daytona.io

# Daytona authentication token
export DAYTONA_TOKEN=your-token-here

# WebSocket proxy timeout
export DAYTONA_WS_TIMEOUT=30000
```

#### Apple Container Provider
```bash
# Lima instance name
export LIMA_INSTANCE=default

# Lima socket path
export LIMA_SOCKET=/run/user/$(id -u)/lima/default/sock
```

## Provider Configuration

### Docker Provider

#### Basic Docker Setup

```bash
# Verify Docker is running
docker info

# Test container creation
docker run --rm hello-world
```

#### Network Configuration

```json
{
  "docker": {
    "network": "bridge",
    "portMapping": "auto",
    "enableIPv6": false,
    "dnsServers": ["8.8.8.8", "8.8.4.4"]
  }
}
```

#### Custom Docker Setup

For custom Docker configurations:

```bash
# Use custom Docker socket
export DOCKER_HOST=tcp://localhost:2376

# Use TLS authentication
export DOCKER_TLS_VERIFY=1
export DOCKER_CERT_PATH=/path/to/certs

# Configure in Apex
apex config set providers.docker.host tcp://localhost:2376
apex config set providers.docker.tls.enabled true
apex config set providers.docker.tls.certPath /path/to/certs
```

### Daytona Provider

#### Authentication Setup

1. **Get Daytona API token**:
   ```bash
   # Login to Daytona CLI
   daytona auth login
   
   # Get token
   daytona auth token
   ```

2. **Configure Apex with token**:
   ```bash
   apex config set providers.daytona.token your-token-here
   apex config set providers.daytona.apiUrl https://api.daytona.io
   ```

#### Workspace Configuration

```json
{
  "daytona": {
    "apiUrl": "https://api.daytona.io",
    "token": "your-token-here",
    "region": "us-west-2",
    "timeout": 30000,
    "retryAttempts": 3
  }
}
```

### Apple Container Provider

#### Lima Configuration

```bash
# Install and setup Lima
brew install lima

# Create custom Lima configuration
tee ~/.lima/apex.yaml << EOF
arch: "default"
memory: "4GiB"
disk: "100GiB"
mounts:
- location: "~"
  writable: true
networks:
- lima: "shared"
EOF

# Start Lima instance for Apex
limactl start apex
```

#### Container Runtime

```json
{
  "appleContainer": {
    "runtime": "lima",
    "instance": "apex",
    "memory": "4GiB",
    "disk": "100GiB",
    "mountHome": true
  }
}
```

## Advanced Configuration

### Performance Tuning

#### Connection Pool Settings

```json
{
  "portRelay": {
    "connectionPool": {
      "maxConnections": 100,
      "idleTimeout": 300000,
      "keepAlive": true,
      "keepAliveInterval": 30000
    }
  }
}
```

#### Memory Optimization

```json
{
  "portRelay": {
    "memory": {
      "maxForwards": 50,
      "connectionBufferSize": 8192,
      "enableCompression": false,
      "gcInterval": 60000
    }
  }
}
```

### Security Configuration

#### TLS/SSL Settings

```json
{
  "portRelay": {
    "security": {
      "enableTLS": false,
      "certificatePath": "/path/to/cert.pem",
      "privateKeyPath": "/path/to/key.pem",
      "caCertPath": "/path/to/ca.pem",
      "tlsMinVersion": "TLSv1.2"
    }
  }
}
```

#### Access Control

```json
{
  "portRelay": {
    "access": {
      "allowedNetworks": ["127.0.0.0/8", "10.0.0.0/8"],
      "blockedPorts": [22, 23, 25, 53, 80, 443],
      "rateLimiting": {
        "enabled": true,
        "maxRequestsPerMinute": 60,
        "maxForwardsPerUser": 20
      }
    }
  }
}
```

### Monitoring and Logging

#### Metrics Collection

```json
{
  "portRelay": {
    "metrics": {
      "enabled": true,
      "interval": 60000,
      "exportPath": "/var/log/apex/port-relay-metrics.json",
      "includeSystemMetrics": true
    }
  }
}
```

#### Log Configuration

```json
{
  "logging": {
    "level": "info",
    "format": "json",
    "outputs": [
      {
        "type": "file",
        "path": "/var/log/apex/port-relay.log",
        "maxSize": "100MB",
        "maxFiles": 10
      },
      {
        "type": "console",
        "colorize": true
      }
    ]
  }
}
```

### High Availability Setup

#### Multiple API Instances

```json
{
  "portRelay": {
    "clustering": {
      "enabled": true,
      "instances": [
        "http://api1.apex.internal:6000",
        "http://api2.apex.internal:6000",
        "http://api3.apex.internal:6000"
      ],
      "loadBalancing": "round-robin",
      "healthCheckInterval": 30000
    }
  }
}
```

#### State Synchronization

```json
{
  "portRelay": {
    "state": {
      "backend": "redis",
      "redis": {
        "host": "redis.apex.internal",
        "port": 6379,
        "password": "your-redis-password",
        "db": 0,
        "keyPrefix": "apex:port-relay:"
      }
    }
  }
}
```

## Troubleshooting Setup Issues

### Common Setup Problems

#### Permission Denied Errors

**Problem**: `EACCES: permission denied, bind EADDRINUSE`

**Solution**:
```bash
# Check if port is in use
lsof -i :8000

# Kill process using the port
sudo kill -9 $(lsof -t -i:8000)

# Or use a different port range
apex config set portRelay.portRange.start 8500
apex config set portRelay.portRange.end 9500
```

#### Docker Connection Failed

**Problem**: `Cannot connect to Docker daemon`

**Solution**:
```bash
# Start Docker service
sudo systemctl start docker    # Linux
brew services start docker     # macOS

# Check Docker permissions
sudo usermod -aG docker $USER  # Linux
# Then log out and back in

# Verify Docker is working
docker ps
```

#### Firewall Blocking Connections

**Problem**: Port forwards created but not accessible

**Solution**:
```bash
# Check firewall status
sudo ufw status                # Ubuntu/Debian
sudo firewall-cmd --list-all   # CentOS/RHEL

# Allow port range
sudo ufw allow 8000:9000/tcp
```

#### Lima/Apple Container Issues

**Problem**: `lima instance not found`

**Solution**:
```bash
# Check Lima status
limactl list

# Start default instance
limactl start default

# Create instance if missing
limactl start --name=default template://docker
```

### Diagnostic Commands

#### System Diagnostics

```bash
# Check Apex installation
apex doctor

# Test port relay functionality
apex port-relay test

# View port relay status
apex port-relay status

# Check configuration
apex config list portRelay
```

#### Network Diagnostics

```bash
# Test port connectivity
nc -zv localhost 8000

# Check active connections
netstat -tuln | grep 8000

# Monitor port relay logs
tail -f ~/.config/apex/logs/port-relay.log
```

#### Debug Mode

```bash
# Run Apex in debug mode
DEBUG=port-relay* apex serve

# Run with verbose logging
APEX_LOG_LEVEL=debug apex serve

# Enable metrics collection
APEX_PORT_RELAY_METRICS=true apex serve
```

### Getting Help

If setup issues persist:

1. **Check system requirements** and dependencies
2. **Review error logs** in detail
3. **Test with minimal configuration** first
4. **Check network and firewall settings**
5. **Consult platform-specific documentation**
6. **File an issue** with:
   - Your OS and version
   - Apex version (`apex --version`)
   - Complete error message
   - Configuration file contents
   - Output of `apex doctor`

### Validation Checklist

Before considering setup complete:

- [ ] Apex CLI installed and accessible
- [ ] Port Relay enabled in configuration
- [ ] Firewall configured to allow port range
- [ ] Provider (Docker/Lima/Daytona) properly configured
- [ ] Test project can forward ports successfully
- [ ] Auto-forwarding works (if enabled)
- [ ] Desktop app can access forwarded services
- [ ] Logs show no persistent errors

## Next Steps

After completing setup:

1. **Read the [User Guide](user-guide.md)** for usage instructions
2. **Review [Architecture Documentation](architecture.md)** for technical details
3. **Check [Developer Guide](developer-guide.md)** if you plan to extend the system
4. **Create a test project** to verify everything works correctly