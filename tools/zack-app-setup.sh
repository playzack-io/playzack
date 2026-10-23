#!/bin/bash
# ZACK! App zum Testen mit Expo Go einrichten und starten
set -e
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js fehlt. Bitte die LTS-Version von https://nodejs.org installieren und dieses Skript danach nochmal starten."
  open "https://nodejs.org" 2>/dev/null || true
  exit 1
fi
DIR="$HOME/Desktop/zack-app"
if [ ! -f "$DIR/package.json" ]; then
  echo "== ZACK!-App wird angelegt (dauert 1-3 Minuten) =="
  cd "$HOME/Desktop"
  npx --yes create-expo-app@latest zack-app --template blank
fi
cd "$DIR"
echo "== Bausteine fuer Webansicht und Vibration =="
npx expo install react-native-webview expo-haptics expo-status-bar
cat > App.js <<'ZACKAPPJS'
import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { WebView } from 'react-native-webview';

// ZACK! als App: lädt playzack.io und gibt Vibration an das Handy weiter
const GAME_URL = 'https://playzack.io/?app=1';
const BG = '#17151b';

function haptic(p) {
  try {
    if (Array.isArray(p)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (p.length > 3) setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 160);
      return;
    }
    const ms = Number(p) || 0;
    if (ms >= 60) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else if (ms >= 30) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (e) {}
}

export default function App() {
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);

  const onMessage = useCallback((e) => {
    let m;
    try { m = JSON.parse(e.nativeEvent.data); } catch (_) { return; }
    if (m && m.t === 'haptic') haptic(m.p);
  }, []);

  if (failed) {
    return (
      <Pressable style={s.center} onPress={() => { setFailed(false); setKey((k) => k + 1); }}>
        <StatusBar style="light" />
        <Text style={s.title}>ZACK!</Text>
        <Text style={s.text}>Keine Verbindung.{'\n'}Tippen zum Neuladen.</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <WebView
        key={key}
        source={{ uri: GAME_URL }}
        style={s.root}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        bounces={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsBackForwardNavigationGestures={false}
        setSupportMultipleWindows={false}
        applicationNameForUserAgent="ZACKApp/1.0"
        startInLoadingState
        renderLoading={() => (
          <View style={[s.center, StyleSheet.absoluteFill]}>
            <ActivityIndicator color="#ffd23f" size="large" />
          </View>
        )}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG, padding: 24 },
  title: { color: '#ffd23f', fontSize: 48, fontWeight: '900', fontStyle: 'italic', marginBottom: 12 },
  text: { color: '#ffffff', fontSize: 18, textAlign: 'center', lineHeight: 26 },
});
ZACKAPPJS
echo ""
echo "== Fertig! Gleich erscheint ein QR-Code. =="
echo "iPhone: Expo Go aus dem App Store installieren, dann den QR-Code mit der normalen Kamera scannen."
echo "Wichtig: iPhone und Mac muessen im selben WLAN sein."
echo "Beenden mit Ctrl + C. Spaeter neu starten mit:  cd ~/Desktop/zack-app && npx expo start"
echo ""
npx expo start
