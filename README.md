# Homebridge Seam

A Homebridge plugin for smart locks via Seam.co API. Control your August, Yale, Schlage, Kwikset, and 100+ other smart lock brands through HomeKit using Seam's universal API.

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

## Features

- 🔐 **Lock/Unlock Control** - Control your smart locks directly from HomeKit
- 🔋 **Battery Monitoring** - Track battery levels with low battery alerts and 1-hour caching
- 🚪 **Door Sensor** - Monitor door open/closed status (if supported by device)
- 🔄 **Real-time Updates** - Automatic webhook management with instant state synchronization
- 🛡️ **Secure Webhooks** - Random UUID paths and auto-generated secrets for security
- ⚡ **Lightweight** - Written in pure JavaScript with zero external dependencies
- 🎯 **Simple Setup** - Easy configuration through Homebridge UI
- 🔧 **Auto Webhook Management** - Webhooks are created/deleted automatically
- 📊 **Real Device Data** - Shows actual manufacturer, model, and serial number in HomeKit
- 🚫 **Race Condition Protection** - Prevents multiple simultaneous lock commands

## Requirements

- Node.js 14.18.1 or higher
- Homebridge 1.3.5 or higher
- Active Seam.co account with API key
- Smart locks already connected to Seam.co

## Installation

### Via Homebridge UI (Recommended)

1. Search for "Seam" in the Homebridge UI plugin search
2. Click **Install**
3. Configure the plugin (see Configuration section)

### Manual Installation

```bash
npm install -g homebridge-seam
```

## Getting Started with Seam.co

Before using this plugin, you need to:

1. Create an account at [Seam Console](https://console.seam.co)
2. Connect your smart lock(s) to Seam through their Connect Webview
3. Get your API key from the Seam Console
4. Note down your device IDs

For detailed instructions, visit [Seam Documentation](https://docs.seam.co/latest/)

## Configuration

### Via Homebridge UI

The easiest way to configure the plugin is through the Homebridge UI:

1. Navigate to the plugin settings
2. Enter your Seam API key
3. Add your device(s) with their Device IDs
4. Optionally configure webhooks and polling settings
5. Save and restart Homebridge

### Manual Configuration

Add the following to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "SeamLock",
      "name": "Seam Lock",
      "apiKey": "seam_****_YOUR_API_KEY",
      "devices": [
        {
          "deviceId": "device_****_YOUR_DEVICE_ID",
          "name": "Front Door"
        },
        {
          "deviceId": "device_****_ANOTHER_DEVICE_ID",
          "name": "Back Door"
        }
      ],
      "polling": {
        "interval": 60
      },
      "webhooks": {
        "enabled": true,
        "url": "https://your-domain.com",
        "port": 8080
      },
      "debug": false
    }
  ]
}
```

### Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `apiKey` | string | Yes | - | Your Seam.co API key |
| `devices` | array | Yes | - | Array of device configurations |
| `devices[].deviceId` | string | Yes | - | Device ID from Seam.co |
| `devices[].name` | string | No | Device name | Custom name for the lock |
| `polling.interval` | number | No | 60 | How often to poll for state updates (in seconds) |
| `webhooks.enabled` | boolean | No | false | Enable webhook server |
| `webhooks.url` | string | No | - | Base URL for webhook endpoint (HTTPS recommended) |
| `webhooks.port` | number | No | 8080 | Port for webhook server (local testing) |
| `debug` | boolean | No | false | Enable debug logging |

**Note:** `webhooks.path` and `webhooks.secret` are auto-generated and managed by the plugin.

## Webhook Setup (Optional)

Webhooks provide real-time state updates without constant polling. The plugin automatically manages webhook creation and deletion.

### Production Setup with HTTPS

For production use, set up HTTPS webhooks using stunnel:

#### 1. Install stunnel and certbot

```bash
sudo apt install stunnel4 certbot
```

#### 2. Get SSL certificate

```bash
# Open port 80 on your router and forward it to homebridge port 80
# Stop Homebridge if needed (if your have it on port 80)
sudo certbot certonly --standalone -d your-domain.com
```

#### 3. Configure stunnel

Create `/etc/stunnel/homebridge.conf`:

```ini
pid = /var/run/stunnel-homebridge.pid
[homebridge]
accept = 443
connect = 127.0.0.1:8080
cert = /etc/letsencrypt/live/your-domain.com/fullchain.pem
key = /etc/letsencrypt/live/your-domain.com/privkey.pem
```

#### 4. Start stunnel

```bash
sudo systemctl enable stunnel4
sudo systemctl restart stunnel4
```

#### 5. Configure plugin

Set webhook URL to `https://your-domain.com` in plugin configuration.

### Webhook Features

- **Automatic Management** - Webhooks are created/deleted automatically
- **Secure Paths** - Each webhook gets a unique random UUID path
- **Auto-generated Secrets** - Security secrets are generated automatically
- **Persistent Configuration** - Webhook settings survive plugin updates

**Note:** Without webhooks, the plugin uses polling (default: every 60 seconds) to check lock state.

## Advanced Features

### Automatic Webhook Management

The plugin automatically handles webhook lifecycle:

- **Creation** - Webhooks are created automatically when enabled
- **Deletion** - Webhooks are deleted when disabled
- **Persistence** - Webhook settings survive plugin updates
- **Security** - Each webhook gets a unique random UUID path

### Battery Caching

Battery level is cached for 1 hour to reduce API calls:

- **Efficient** - Reduces unnecessary API requests
- **Accurate** - Fresh data when needed
- **Configurable** - Cache timeout can be adjusted

### Race Condition Protection

Prevents multiple simultaneous lock commands:

- **Command Queue** - Commands are queued and executed sequentially
- **Timeout Protection** - Commands timeout after 15 seconds
- **State Locking** - Prevents polling interference during commands

### Real Device Information

Shows actual device data in HomeKit:

- **Manufacturer** - Real manufacturer name (e.g., "August", "Yale")
- **Model** - Actual model name from device
- **Serial Number** - Real serial number from device
- **Firmware** - Device firmware version

## Supported Devices

This plugin supports any smart lock that works with Seam.co, including:

### Popular Brands
- **August** - All generations (August Smart Lock Pro, August Smart Lock 4th Gen, etc.)
- **Yale** - All Assure Lock models (Yale Assure Lock SL, Yale Assure Lock 2, etc.)
- **Schlage** - Encode series (Schlage Encode, Schlage Encode Plus, etc.)
- **Kwikset** - Halo series (Kwikset Halo, Kwikset Halo Touch, etc.)

### Additional Brands
- **Lockly** - Secure Plus, Vision Elite, and other models
- **Nuki** - Smart Lock 3.0, Smart Lock 2.0, and accessories
- **Salto** - Various electronic lock models
- **Minut** - Smart lock solutions
- **Tedee** - Smart lock systems
- **And 100+ more brands!**

For the complete list of supported devices, visit [Seam Supported Devices](https://docs.seam.co/latest/)

**Note:** This plugin works with any device that's compatible with Seam.co's universal API, regardless of the manufacturer.

## HomeKit Features

Each lock will appear in HomeKit with:

- **Lock Mechanism** - Lock/unlock control with current state
- **Battery Service** - Battery level and low battery indicator with 1-hour caching
- **Accessory Information** - Real device data (manufacturer, model, serial number, firmware)
- **Race Condition Protection** - Prevents multiple simultaneous commands
- **Real-time Updates** - Instant state synchronization via webhooks

## Troubleshooting

### Plugin doesn't start

- Check that your API key is correct
- Ensure device IDs are valid
- Check Homebridge logs for error messages

### Lock state not updating

- Verify your lock is online in Seam Console
- Check polling interval in configuration
- Enable debug mode for more detailed logs

### Webhook not working

- Ensure webhook port is accessible from the internet
- Check firewall and router port forwarding settings
- Verify webhook URL is correct and accessible
- Check plugin logs for webhook registration status
- For HTTPS setup, ensure SSL certificate is valid

### Device data not showing

- Enable debug logging to see device information extraction
- Check if device provides manufacturer/model data in Seam Console
- Some devices may not have complete information

### Low battery not showing

- Some locks don't report battery level
- Check if battery level is available in Seam Console
- Battery data is cached for 1 hour to reduce API calls

### Lock commands not working

- Check if device is online in Seam Console
- Verify API key has proper permissions
- Enable debug logging to see command execution
- Check for race conditions (multiple simultaneous commands)

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/350d/homebridge-seam/issues)

## License

MIT License - see LICENSE file for details

## Credits

- Built with [Homebridge](https://homebridge.io/)
- Powered by [Seam.co](https://www.seam.co/)

## Disclaimer

This plugin is not officially affiliated with or endorsed by Seam.co, August, Yale, or any lock manufacturers.
