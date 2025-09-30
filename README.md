# Homebridge Seam

A Homebridge plugin for smart locks via Seam.co API. Control your Yale, August, and other smart locks through HomeKit.

## Features

- 🔐 **Lock/Unlock Control** - Control your smart locks directly from HomeKit
- 🔋 **Battery Monitoring** - Track battery levels with low battery alerts
- 🚪 **Door Sensor** - Monitor door open/closed status (if supported by device)
- 🔄 **Real-time Updates** - Optional webhook support for instant state synchronization
- ⚡ **Lightweight** - Written in pure JavaScript with zero external dependencies
- 🎯 **Simple Setup** - Easy configuration through Homebridge UI

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
        "enabled": false,
        "port": 8080,
        "path": "/webhook"
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
| `webhooks.port` | number | No | 8080 | Port for webhook server |
| `webhooks.path` | string | No | /webhook | URL path for webhook endpoint |
| `debug` | boolean | No | false | Enable debug logging |

## Webhook Setup (Optional)

Webhooks provide real-time state updates without constant polling:

1. Enable webhooks in plugin configuration
2. Set up port forwarding or use a service like ngrok to expose your webhook endpoint
3. Register your webhook URL in Seam Console or the plugin will attempt to do it automatically

**Note:** Without webhooks, the plugin uses polling (default: every 60 seconds) to check lock state.

## Supported Devices

This plugin supports any smart lock that works with Seam.co, including:

- August Smart Lock (all generations)
- Yale Assure Lock (all models)
- Schlage Encode
- Kwikset Halo
- and many more!

For the full list, visit [Seam Supported Devices](https://docs.seam.co/latest/)

## HomeKit Features

Each lock will appear in HomeKit with:

- **Lock Mechanism** - Lock/unlock control with current state
- **Battery Service** - Battery level and low battery indicator
- **Contact Sensor** - Door open/closed status (if supported)

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
- Verify webhook is registered in Seam Console

### Low battery not showing

- Some locks don't report battery level
- Check if battery level is available in Seam Console

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/350d/homebridge-seam/issues)

## License

MIT License - see LICENSE file for details

## Credits

- Built with [Homebridge](https://homebridge.io/)
- Powered by [Seam.co](https://www.seam.co/)

## Disclaimer

This plugin is not officially affiliated with or endorsed by Seam.co, August, Yale, or any lock manufacturers.
