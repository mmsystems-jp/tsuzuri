import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

const KEY_REVIEWED = 'review_requested';
const KEY_COUNT = 'total_entries';
const THRESHOLD = 5;

export async function incrementAndCheckReview() {
  try {
    const alreadyRequested = await AsyncStorage.getItem(KEY_REVIEWED);
    if (alreadyRequested === 'true') return;

    const raw = await AsyncStorage.getItem(KEY_COUNT);
    const current = raw ? parseInt(raw, 10) : 0;
    const next = current + 1;
    await AsyncStorage.setItem(KEY_COUNT, String(next));

    if (next >= THRESHOLD) {
      const available = await StoreReview.isAvailableAsync();
      if (available) {
        await StoreReview.requestReview();
      }
      await AsyncStorage.setItem(KEY_REVIEWED, 'true');
    }
  } catch {
    // レビューリクエストの失敗はサイレントに無視する
  }
}
