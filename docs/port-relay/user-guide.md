# Port Relay User Guide

The Port Relay feature provides VS Code-style port forwarding capabilities in Apex, allowing you to securely access services running inside sandboxes from your local machine. This comprehensive system automatically detects running services and creates secure tunnels, making development workflows seamless across all supported providers (Docker, Apple Container, and Daytona).

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [User Interface](#user-interface)
- [Manual Port Forwarding](#manual-port-forwarding)
- [Auto-forwarding](#auto-forwarding)
- [Settings and Configuration](#settings-and-configuration)
- [Desktop vs Web Experience](#desktop-vs-web-experience)
- [Troubleshooting](#troubleshooting)
- [FAQ](#frequently-asked-questions)

## Overview

### What is Port Relay?

Port Relay is a port forwarding system that creates secure tunnels between your local machine and services running inside Apex sandboxes. When a service runs on a port inside a sandbox (e.g., port 3000), Port Relay can make it accessible on your local machine (e.g., `http://localhost:8001`).

### Key Features

- **🔍 Automatic port detection**: Real-time discovery of running services in your sandboxes via intelligent port scanning
- **⚡ One-click forwarding**: Forward ports instantly with a single click from the intuitive Ports panel
- **🔄 Auto-forwarding**: Intelligent auto-forwarding of new services with configurable rules and exclusions
- **🌐 Cross-provider support**: Seamless operation across Docker, Apple Container, and Daytona cloud sandboxes
- **🖥️ Desktop integration**: Native TCP port forwarding in the desktop app with true localhost URLs
- **🛡️ Secure tunnels**: End-to-end encrypted connections with authentication and authorization
- **📊 Health monitoring**: Continuous monitoring of forwarded ports with automatic failure detection and recovery
- **🔧 Advanced configuration**: Customizable port ranges, exclusion lists, and auto-forwarding policies
- **📱 Multi-platform UI**: Consistent experience across desktop app and web interface
- **🚀 High performance**: Optimized for low latency and high throughput with connection pooling

### When to Use Port Relay

- **🌐 Web development**: Access React, Vue.js, Next.js, Angular, and other development servers running inside sandboxes
- **🔌 API development**: Connect to REST APIs, GraphQL servers, Express, FastAPI, Django services for testing and debugging
- **🗄️ Database access**: Connect local database clients (pgAdmin, TablePlus, MySQL Workbench) to sandbox databases (PostgreSQL, MySQL, Redis, MongoDB)
- **🐛 Service debugging**: Use local debugging tools, profilers, and monitoring solutions with services running in sandboxes
- **⚡ Microservices**: Access complex multi-service architectures with automatic forwarding of all service ports
- **🔧 Integration testing**: Test applications that communicate across multiple ports and services
- **📊 Monitoring and observability**: Connect local monitoring tools to metrics endpoints, health checks, and logging services
- **🎯 Load testing**: Run local load testing tools against sandbox services with minimal latency overhead

## Getting Started

### Prerequisites

- Apex CLI or Desktop application installed
- An active project with a running sandbox
- Network connectivity to the sandbox provider

### Quick Start

1. **Start a service in your sandbox**:
   ```bash
   # In your Apex terminal/sandbox
   npm run dev  # Starts a React development server on port 3000
   # or
   python -m http.server 8080  # Starts a Python HTTP server
   # or  
   docker-compose up  # Starts multiple services on various ports
   ```

2. **Open the Ports panel**:
   - **Desktop**: Click the ports indicator in the status bar (e.g., "Ports: 2 forwarded, 1 detected") or use `Ctrl+Shift+P` → "View: Toggle Ports Panel"
   - **Web**: Click the "Ports" tab in the bottom panel next to "Terminal"

3. **Forward the port**:
   - **Automatic**: If auto-forwarding is enabled, the port appears as "Forwarded" within seconds
   - **Manual**: Click "Forward" next to any detected port (e.g., port 3000)
   - The system automatically selects an available local port (e.g., `localhost:8001`)
   - You can optionally specify a preferred local port

4. **Access your service**:
   - **Desktop**: Click the localhost URL (e.g., `http://localhost:8001`) to open in your default browser
   - **Web**: Click the preview URL to access the service through Apex's proxy
   - **Command line**: Use `curl http://localhost:8001` or any local tool

5. **Manage forwards**:
   - Click "Stop" to remove a forward
   - Click "Copy URL" to copy the localhost URL to clipboard
   - Click the settings icon (⚙️) to configure auto-forwarding and exclusions

## User Interface

### Ports Panel

The Ports panel shows all detected and forwarded ports for your project:

```
┌─────────────────────────────────────────────────────────────┐
│                         Ports                                │
├─────────────────────────────────────────────────────────────┤
│  Port │ Process      │ Status      │ Actions                 │
├─────────────────────────────────────────────────────────────┤
│  3000 │ npm run dev  │ Forwarded   │ http://localhost:8001   │
│       │              │             │ [Stop] [Copy URL]       │
├─────────────────────────────────────────────────────────────┤
│  8080 │ python -m    │ Detected    │ [Forward] [Copy Preview]│
│       │ http.server  │             │                         │
├─────────────────────────────────────────────────────────────┤
│  5432 │ postgres     │ Not Running │ [Forward]               │
│       │              │             │                         │
└─────────────────────────────────────────────────────────────┘
```

### Port Status Indicators

- **🟢 Forwarded**: Port is actively forwarded and accessible locally
- **🔍 Detected**: Service detected but not forwarded  
- **🔴 Failed**: Forwarding failed (hover for error details)
- **⏸️ Stopped**: Forwarding was stopped
- **➕ Manual**: Manually added port (service may not be running)

### Status Bar Indicator (Desktop)

The desktop app shows a ports indicator in the status bar:

```
Ports: 2 forwarded, 1 detected
```

Click the indicator to open the Ports panel.

## Manual Port Forwarding

### Adding a Port Manually

Sometimes you need to forward a port before the service starts, or the auto-detection doesn't pick it up:

1. **Click "Add Port" in the Ports panel**
2. **Enter the port number** (e.g., 5432)
3. **Click "Forward"**
4. **The port is now reserved** and will be forwarded when a service starts

### Forwarding Specific Ports

You can forward any port manually:

1. **In the Ports panel**, find or add the desired port
2. **Click "Forward"** next to the port
3. **Choose a local port** (optional - Apex will pick one if not specified)
4. **Access the service** at the provided localhost URL

### Removing Port Forwards

To stop forwarding a port:

1. **Find the forwarded port** in the Ports panel
2. **Click "Stop"** next to the port
3. **The tunnel is closed** and the local port is freed

## Auto-forwarding

### How Auto-forwarding Works

When enabled, Apex automatically forwards new TCP ports as services start in your sandbox:

1. **Service starts** on port 3000 in sandbox
2. **Apex detects** the new port via port scanning
3. **Auto-forwarding creates** a tunnel to localhost:8001
4. **You're notified** via the ports panel and status bar

### Enabling Auto-forwarding

**Per Project** (temporary):
1. Open the Ports panel
2. Click the settings icon (⚙️)
3. Toggle "Auto-forward new ports"

**Globally** (persistent):
1. Open Apex Settings (`Ctrl+,`)
2. Navigate to "Port Relay" section
3. Enable "Auto-forward new ports by default"

### Auto-forwarding Rules

Auto-forwarding follows these rules:
- **Only TCP ports** are forwarded (UDP is ignored)
- **Excluded ports are skipped** (configurable list)
- **Maximum limit** of auto-forwards per project (default: 10)
- **Existing forwards are preserved** (no duplicates)

### Default Excluded Ports

These ports are excluded from auto-forwarding by default:
- `8080`, `8443`, `8888` - Common development/proxy ports
- `3001` - Often used by Apex's internal proxy

You can customize this list in the Port Relay settings.

## Settings and Configuration

### Accessing Settings

**Desktop App**:
- `Ctrl+,` (Windows/Linux) or `Cmd+,` (macOS)
- Navigate to "Port Relay" section

**Web Interface**:
- Settings → Extensions → Port Relay

### Configuration Options

#### General Settings

- **Enable Port Relay**: Master on/off switch for the entire feature
- **Auto-forward new ports**: Automatically forward detected ports
- **Max auto-forwards**: Maximum number of ports to auto-forward per project (1-20)

#### Port Range Configuration

- **Local port range**: Range of local ports to use for forwarding
  - Default: 8000-9000
  - Avoid conflicts with common development ports
  - Must have at least 10 available ports in range

#### Excluded Ports

- **Auto-forward exclusions**: Ports that should never be auto-forwarded
  - Default: `8080, 8443, 8888, 3001`
  - Add ports that you don't want automatically forwarded
  - Useful for avoiding conflicts with other tools

#### Advanced Settings

- **Health check interval**: How often to check if forwarded ports are still healthy (default: 30s)
- **Connection timeout**: Maximum time to wait for connections (default: 5s)  
- **Retry attempts**: Number of times to retry failed forwards (default: 3)

### Persistence

- **Auto-forwarding preference** is saved per project
- **Manual port additions** are remembered per project
- **Global settings** are saved in your Apex configuration
- **Forwarding state** is restored when reopening projects

## Desktop vs Web Experience

### Desktop Application

The desktop app provides **native port forwarding** with these advantages:

- **True localhost access**: Forwarded ports are accessible at real localhost URLs
- **No proxy required**: Direct TCP tunnels for better performance
- **Operating system integration**: Works with any local tool or browser
- **Persistent across sessions**: Forwards survive app restarts

**Desktop Port Flow**:
```
Sandbox:3000 ←→ WebSocket Tunnel ←→ Local TCP Server:8001 ←→ Your Browser
```

### Web Interface

The web interface provides **proxy-based forwarding**:

- **Preview URLs**: Access services through Apex's preview URL system
- **No local forwarding**: Ports aren't actually forwarded to localhost  
- **Browser-based**: Works entirely through the web browser
- **Secure by design**: All traffic goes through authenticated proxies

**Web Port Flow**:
```
Sandbox:3000 ←→ Apex Proxy ←→ Preview URL ←→ Your Browser
```

### Choosing the Right Experience

**Use Desktop when**:
- You need true localhost access for local tools
- Working with desktop applications that connect to services
- Performance is critical (lower latency)
- You want persistent forwards across sessions

**Use Web when**:
- You prefer browser-based development
- Working from various devices/locations
- Security requirements prohibit local forwarding
- You only need browser access to services

## Troubleshooting

### Common Issues

#### "Port forwarding failed" Error

**Symptoms**: Port shows as "Failed" with a red indicator

**Causes**:
- Local port already in use
- Service not responding in sandbox
- Network connectivity issues
- Firewall blocking connections

**Solutions**:
1. Check if local port is available: `netstat -an | grep 8001`
2. Verify service is running in sandbox
3. Try a different local port
4. Check firewall settings
5. Restart the port forward

#### Auto-forwarding Not Working

**Symptoms**: New services aren't automatically forwarded

**Troubleshooting**:
1. Verify auto-forwarding is enabled in settings
2. Check if port is in the excluded list
3. Ensure you haven't hit the max auto-forwards limit
4. Look for port scanning errors in the console

#### "Connection Refused" on Localhost

**Symptoms**: Can't connect to forwarded localhost URL

**Solutions**:
1. Verify the port forward is active (green status)
2. Check that the service is actually running in sandbox
3. Try refreshing the forward (Stop → Forward)
4. Verify the service is listening on all interfaces (not just localhost)

#### Slow Performance

**Symptoms**: Forwarded services are slow to respond

**Optimization**:
1. Use the desktop app for better performance
2. Check network connectivity to sandbox
3. Reduce health check frequency
4. Consider port forwarding fewer services

### Debug Information

#### Viewing Port Forward Status

Desktop app console commands:
```javascript
// In DevTools console
portRelay.getStatus()  // Get current forwarding status
portRelay.getConfig()  // View current configuration
```

#### Log Files

**Desktop App**: 
- macOS: `~/Library/Logs/Apex/port-relay.log`
- Windows: `%APPDATA%/Apex/logs/port-relay.log`
- Linux: `~/.local/share/Apex/logs/port-relay.log`

**Web Interface**: 
- Browser DevTools Console → Look for `[port-relay]` messages

### Getting Help

If you continue to experience issues:

1. **Check the logs** for specific error messages
2. **Try with a fresh project** to isolate the issue
3. **Restart the Apex application**
4. **File an issue** with:
   - Error message details
   - Steps to reproduce
   - Your OS and Apex version
   - Sandbox provider (Docker/Apple Container/Daytona)

## Frequently Asked Questions

### General Usage

**Q: What's the difference between port forwarding and preview URLs?**
A: Port forwarding creates actual localhost tunnels (desktop only), while preview URLs are proxy-based access through Apex's servers. Preview URLs work in both desktop and web, but localhost forwarding only works in the desktop app.

**Q: Can I forward the same port from multiple projects?**
A: No, each forwarded port uses a unique local port. If multiple projects use port 3000, they'll be forwarded to different local ports (e.g., 8001, 8002).

**Q: Why aren't my UDP ports being forwarded?**
A: Port Relay only supports TCP forwarding. UDP forwarding is not currently supported due to technical limitations.

### Configuration

**Q: How do I change the default local port range?**
A: In Settings → Port Relay → Port Range, adjust the start and end values. Ensure you have enough ports in the range for your needs.

**Q: Can I exclude specific ports from auto-forwarding?**
A: Yes, add port numbers to the "Excluded Ports" list in Port Relay settings. These ports will never be auto-forwarded but can still be manually forwarded.

**Q: How do I disable auto-forwarding for all projects?**
A: In Settings → Port Relay, disable "Auto-forward new ports by default". This affects new projects; existing projects retain their individual settings.

### Technical Questions

**Q: How secure are port forwards?**
A: Very secure. Desktop forwards use encrypted WebSocket tunnels with authentication. All traffic is encrypted in transit and requires valid Apex credentials.

**Q: Does port forwarding work with databases?**
A: Yes, you can forward database ports (PostgreSQL 5432, MySQL 3306, etc.) and connect with local database tools like pgAdmin or TablePlus.

**Q: Can I use port forwarding with Docker Compose?**
A: Yes, Apex detects ports from Docker Compose services. Just ensure services are configured to bind to `0.0.0.0` (not just `127.0.0.1`) so they're accessible from outside the container.

**Q: What happens if my internet connection drops?**
A: Port forwards will automatically attempt to reconnect when connectivity is restored. You may need to refresh the forward if it doesn't recover automatically.

### Performance

**Q: Is there any latency introduced by port forwarding?**
A: Yes, but it's minimal. Desktop forwarding has lower latency than web-based preview URLs. Latency depends on your network connection to the sandbox provider.

**Q: How many ports can I forward simultaneously?**
A: There's no hard limit, but practical limits depend on your system resources and network bandwidth. The default auto-forward limit is 10 ports per project.

**Q: Does port forwarding affect sandbox performance?**
A: Minimal impact. Port forwarding uses lightweight tunnels and doesn't significantly affect sandbox resources or performance.