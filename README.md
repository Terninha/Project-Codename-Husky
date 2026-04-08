# Project-Codename-Husky

A modern web application to centralize and explore all Lore Books from the Destiny universe, using the official Bungie API.

## 🎮 About

LoreHub is a fan-made project dedicated to aggregating all Lore Books from the Destiny game in one place, making it easy to search, filter and read the expanded story of the universe.

## ✨ Features

- 📚 **Load Lore Books**: Fetch all available lore books from the Bungie API
- 🔍 **Search and Filter**: Search by name or description in real time
- 📋 **Sorting**: Sort by name or last edit date
- 🎨 **Responsive Interface**: Modern design that works on desktop and mobile
- 💾 **Smart Cache**: Stores data for better performance
- 🔄 **Automatic Retry**: Automatic retry system on API failures
- 📱 **Mobile-First Design**: Fully optimized for mobile devices

## 🛠️ Technologies

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **API**: Bungie.net REST API
- **Storage**: Local Storage (cache)
- **No external dependencies**: Pure project without frameworks

## 📁 Project Structure

```
LoreHub/
├── index.html              # Main HTML file
├── src/
│   ├── css/
│   │   ├── style.css      # Main styles
│   │   └── responsive.css # Media queries
│   ├── js/
│   │   ├── config.js      # Application configuration
│   │   ├── api-handler.js # API request manager
│   │   ├── ui-manager.js  # UI manager
│   │   └── main.js        # Main logic
│   └── api/
│       └── endpoints.md   # Endpoints documentation
├── public/                 # Static files (images, etc)
├── docs/                   # Additional documentation
├── README.md              # This file
└── package.json           # Project config (optional)
```

## 🚀 Quick Start

**Already have your API Key?** 👉 [Go to QUICK_START.md](docs/QUICK_START.md)

**Need to get an API Key first?** 👉 [See BUNGIE_REGISTRATION.md](docs/BUNGIE_REGISTRATION.md)

### Prerequisites

1. A Bungie.net API Key
   - Visit: https://www.bungie.net/en/Application
   - Create a new application
   - Copy your API Key

**👉 [See detailed registration guide](docs/BUNGIE_REGISTRATION.md)**

### Installation

1. Clone or download the project:
```bash
git clone https://github.com/your-username/lorehub.git
cd lorehub
```

2. Copy environment example file:
```bash
cp .env.example .env.local
# Edit .env.local and add your API Key
```

Or copy configuration example:
```bash
cp src/js/config.local.example.js src/js/config.local.js
# Edit config.local.js and add your API Key
```

3. Open `index.html` in your browser

4. Configure the API Key (if not using .env or config.local.js):
   - Open Developer Tools (F12)
   - In the console, execute:
```javascript
window.setApiKey("your-api-key-here")
```

5. Click the "Load Lores" button to start

**👉 [See detailed setup guide](docs/SETUP.md)**

### Local Development

If you want to serve the application locally:

```bash
# Using Python 3
python -m http.server 8000

# Or using Node.js with http-server
npx http-server

# Or using Live Server in VS Code
# Install the "Live Server" extension and click "Go Live"
```

Access: `http://localhost:8000`

## 📖 User Guide

### 1. Load Lore Books
- Click the "Load Lores" button in the hero section
- Wait for data to load

### 2. Search Lores
- Use the search bar to search by name or description
- Search is real-time (no need to press Enter)

### 3. Filter and Sort
- Use the "Sort by" dropdown to change the display order
- Options: Name or Date

### 4. View Details
- Click any lore card to view full details
- A modal will open with the information

## 🔧 Configuration

### File: `src/js/config.js`

```javascript
const CONFIG = {
    API_KEY: 'YOUR_API_KEY_HERE',  // Configure here
    CACHE_DURATION: 3600000,        // 1 hour
    MAX_RETRIES: 3,                 // Reconnection attempts
};
```

**⚠📚 Documentation

The project includes comprehensive documentation:

| Document | Purpose |
|----------|---------|
| [QUICK_START.md](docs/QUICK_START.md) | ⚡ **START HERE** - Get running in 2 minutes! |
| [BUNGIE_REGISTRATION.md](docs/BUNGIE_REGISTRATION.md) | Step-by-step API key registration |
| [SETUP.md](docs/SETUP.md) | Complete setup and troubleshooting guide |
| [CONFIGURATION_EXAMPLES.md](docs/CONFIGURATION_EXAMPLES.md) | Secure configuration methods |
| [API_ENDPOINTS.md](docs/API_ENDPOINTS.md) | API endpoints documentation |

## ️ SECURITY**: Never commit actual API keys to Git!

See [Configuration Examples](docs/CONFIGURATION_EXAMPLES.md) for secure configuration methods:
- Environment variables (.env file)
- Local configuration (config.local.js)
- Console setup
- Production deployment

## 🌐 API Endpoints Used

- `GET /Destiny2/Definitions/DestinyLoreDefinition/` - List all lore books
- `GET /Destiny2/Definitions/DestinyInventoryItemDefinition/{id}` - Details of a specific item

## 🎨 Customizing the Design

### Colors

All colors are defined as CSS variables in `src/css/style.css`:

```css
:root {
    --primary-color: #1a1a2e;
    --secondary-color: #16213e;
    --accent-color: #0f3460;
    --highlight-color: #e94560;
    --text-light: #f0f0f0;
}
```

Modify these variables to change the application design.

## 🐛 Troubleshooting

### "API Key not configured"
- Open DevTools (F12)
- Execute: `window.setApiKey("your-key")`

### "Error loading lore books"
- Verify your API Key is valid
- Check your internet connection
- Test connection: `window.testApiConnection()`

### "Cache too large"
- Clear cache: `window.clearAllCache()`

### View debug information
- Execute: `window.debugInfo()`

## 💡 Console Functions

The application provides useful functions in the browser console:

```javascript
// Configure API Key
window.setApiKey("your-api-key")

// View debug information
window.debugInfo()

// Clear cache
window.clearAllCache()

// Test API connection
window.testApiConnection()
```

## 📝 Bungie API

The Bungie API is free but has rate limits:
- **Limit**: ~600 requests per hour
- **Documentation**: https://bungie-net.github.io/

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the project
2. Create a branch for your feature (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This is an unofficial fan-made project for educational and entertainment purposes.

Destiny is a registered trademark of Bungie, Inc. All rights reserved.

## ⚖️ Legal Notice

This project is created by fans for educational and entertainment purposes. We are not affiliated with, endorsed by, or sponsored by Bungie, Inc.

## 🙏 Acknowledgments

- [Bungie.net](https://www.bungie.net) - For the excellent public API
- Destiny Community - For inspiring this project

## 📞 Support

For questions or issues, please open an issue in the repository.

---

**Developed with ❤️ for the Destiny community**
