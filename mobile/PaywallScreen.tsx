import React, { useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

export default function PaywallScreen({ onPurchased, onClose }: { onPurchased: () => void; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function purchasePro() {
    setLoading(true);
    setError('');
    try {
      // RevenueCat replacement for MVP: simulate a successful purchase.
      await new Promise((resolve) => setTimeout(resolve, 800));
      onPurchased();
    } catch {
      setError('Не удалось оформить подписку. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Text style={styles.logo}>ScrollEd Pro</Text><Pressable onPress={onClose}><Text style={styles.close}>Закрыть</Text></Pressable></View>
      <View style={styles.content}>
        <Text style={styles.kicker}>БЕЗ РЕКЛАМЫ · БОЛЬШЕ ВОЗМОЖНОСТЕЙ</Text>
        <Text style={styles.title}>Учитесь без ограничений</Text>
        <Text style={styles.subtitle}>Загружайте книги сверх лимита Free и получайте чистую ленту без рекламы.</Text>
        <View style={styles.priceRow}><Text style={styles.price}>$7</Text><Text style={styles.period}>/ месяц</Text></View>
        <Text style={styles.trial}>Первые 3 месяца бесплатно</Text>
        <View style={styles.features}>
          <Text style={styles.feature}>До и после триала: полный доступ к Pro</Text>
          <Text style={styles.feature}>Без рекламы</Text>
          <Text style={styles.feature}>Подписка управляется через RevenueCat</Text>
        </View>
        <Pressable disabled={loading} onPress={purchasePro} style={styles.button}>
          {loading ? <ActivityIndicator color="#101418" /> : <Text style={styles.buttonText}>Купить подписку</Text>}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.legal}>Покупка будет подтверждена сервером через RevenueCat webhook.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101418' },
  header: { height: 76, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#283139' },
  logo: { color: '#F6F3EA', fontSize: 24, fontWeight: '800' },
  close: { color: '#B6C1BD', fontSize: 14 },
  content: { flex: 1, padding: 26, justifyContent: 'center' },
  kicker: { color: '#E47752', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#F6F3EA', fontSize: 34, lineHeight: 40, fontWeight: '800', marginTop: 14 },
  subtitle: { color: '#B6C1BD', fontSize: 17, lineHeight: 25, marginTop: 14 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 30 },
  price: { color: '#F6F3EA', fontSize: 58, fontWeight: '800' },
  period: { color: '#B6C1BD', fontSize: 18, marginLeft: 8 },
  trial: { color: '#B8D9C6', fontSize: 17, fontWeight: '700', marginTop: 4 },
  features: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#283139', paddingVertical: 18, marginTop: 28, gap: 12 },
  feature: { color: '#D7DEDA', fontSize: 15, lineHeight: 21 },
  button: { minHeight: 54, backgroundColor: '#E47752', borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  buttonText: { color: '#101418', fontSize: 16, fontWeight: '800' },
  error: { color: '#F0A38C', marginTop: 16 },
  legal: { color: '#7F8C8A', fontSize: 12, lineHeight: 18, marginTop: 18 },
});
