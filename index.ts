import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const base = '/ToteHome/';
  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  manifest.href = `${base}manifest.json`;
  document.head.appendChild(manifest);
  const theme = document.createElement('meta');
  theme.name = 'theme-color';
  theme.content = '#18332F';
  document.head.appendChild(theme);
  if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
    window.addEventListener('load', () => navigator.serviceWorker.register(`${base}sw.js`).catch(() => {}));
  }
}
