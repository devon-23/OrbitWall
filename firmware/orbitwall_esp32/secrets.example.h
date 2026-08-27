// Copy this file to secrets.h and fill in your own values.
// secrets.h is gitignored — never commit real credentials.

#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// The LAN IP of the machine running the OrbitWall server, with port.
// Not "localhost" — that would point at the ESP32 itself.
// Find it with `ipconfig getifaddr en0` on macOS.
#define SERVER_HOST "192.168.1.50:3000"
