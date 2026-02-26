import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

WebBrowser.maybeCompleteAuthSession();

export default function App() {
  const [status, setStatus] = useState('起動中...');

  useEffect(() => {
    async function init() {
      try {
        setStatus('SecureStore確認中...');
        const token = await SecureStore.getItemAsync('tsz_token');
        setStatus('token: ' + (token ? 'あり' : 'なし'));

        if (!token) {
          setStatus('完了：tokenなし → ログイン画面へ');
          return;
        }

        setStatus('LocalAuth確認中...');
        const hasBio = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        setStatus(`完了：bio=${hasBio} enrolled=${isEnrolled}`);
      } catch (e) {
        setStatus('エラー: ' + e.message);
      }
    }
    init();
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'orange' }}>
      <Text style={{ color: 'white', fontSize: 18, textAlign: 'center', padding: 20 }}>{status}</Text>
    </View>
  );
}
