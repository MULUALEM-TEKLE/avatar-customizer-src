# Avatar Customizer

A Three.js-powered 3D avatar customization application featuring real-time clothing changes, animations, and interactive music player.

## Features

### 🎨 Avatar Customization
- **Real-time clothing changes** - Switch between different clothing items including jackets, hoodies, pants, coveralls, boots, and accessories
- **Clothing compatibility system** - Automatic handling of incompatible clothing combinations
- **Base clothing visibility management** - Smart visibility controls for underwear and base clothing layers

### 🎭 Animation System
- **Multiple character animations** - Cycle through various character poses and movements
- **Smooth animation crossfading** - Seamless transitions between different animations
- **Interactive animation controls** - Click to trigger different animation sequences

### 🎵 Music & Audio
- **Integrated music player** - Built-in Webamp-style music player with classic Winamp skins
- **Audio visualization** - Real-time audio frequency analysis and visualization
- **Multiple audio tracks** - Pre-loaded music tracks for ambient experience

### 📸 Screenshot System
- **High-quality screenshots** - Capture and download images of your customized avatar
- **Instant preview** - Real-time rendering of customization changes

### 🌍 3D Environment
- **Immersive 3D world** - Beautiful HDR environment with realistic lighting
- **Ocean animation** - Dynamic animated ocean environment
- **Camera controls** - Zoom and rotate to get the perfect view of your avatar

### 📱 Cross-Platform Support
- **Responsive design** - Optimized for both desktop and mobile devices
- **Touch-friendly controls** - Mobile-optimized interface and interactions

## Tech Stack

- **Three.js** - 3D graphics and rendering
- **Vite** - Fast build tool and development server
- **GSAP** - Animation library
- **Webamp** - Classic Winamp-style music player
- **lil-gui** - Debug and control interface
- **Postprocessing & Realism Effects** - Advanced visual effects

## Setup

### Prerequisites
Download [Node.js](https://nodejs.org/en/download/) (version 16 or higher recommended).

### Installation & Development

```bash
# Install dependencies (only the first time)
pnpm install

# Run the local development server at localhost:5173
pnpm run dev

# Build for production in the dist/ directory
pnpm run build
```

## Project Structure

```
src/
├── modules/
│   ├── audio.js              # Audio system and frequency analysis
│   ├── cameraZoomSystem.js   # Camera zoom controls
│   ├── character.js          # Avatar loading and clothing system
│   ├── colorPickerSystem.js  # Color customization (experimental)
│   ├── environment.js        # 3D environment and ocean animation
│   ├── loadingManager.js     # Asset loading management
│   ├── modelRotateSystem.js  # Model rotation controls
│   ├── musicPlayer.js        # Webamp music player integration
│   ├── screenshotSystem.js   # Screenshot capture functionality
│   ├── userInterfaceManager.js # UI controls and clothing management
│   └── world.js              # Three.js scene setup
├── script.js                 # Main application entry point
├── style.css                 # Application styles
└── index.html                # HTML template

static/
├── models/                   # 3D models (avatar and environment)
├── img/                      # Clothing item thumbnails
├── audios/                   # Music tracks
├── hdri/                     # HDR environment maps
└── webampSkins/              # Winamp player skins
```

## Usage

1. **Start the development server** with `pnpm run dev`
2. **Open your browser** to `http://localhost:5173`
3. **Customize your avatar** using the clothing selection interface
4. **Try different animations** with the animation button
5. **Play music** using the integrated Webamp player
6. **Take screenshots** of your customized avatar
7. **Zoom and rotate** to get the perfect view

## Browser Compatibility

- Modern browsers with WebGL support
- Chrome, Firefox, Safari, Edge (latest versions)
- Mobile browsers on iOS and Android

## Development

This project uses Vite for fast development and building. The modular architecture makes it easy to extend with new features:

- Add new clothing items by placing models in `/static/models/` and thumbnails in `/static/img/`
- Extend the animation system in `character.js`
- Customize the UI in `userInterfaceManager.js`
- Add new audio tracks to `/static/audios/`

## License

This project is private and not intended for public distribution.
