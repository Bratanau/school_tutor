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
      <View style={styles.header}><Text style={styles.logo}>ScrollEd Pro</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}><Text style={styles.close}>Закрыть</Text></Pressable></View>
      <View style={styles.content}>
        <Text style={styles.kicker}>PRO ПЛАН</Text>
        <Text style={styles.title}>Больше возможностей для учёбы.</Text>
        <Text style={styles.subtitle}>Храните библиотеку, загружайте PDF без ограничений и учитесь без рекламы.</Text>
        <View style={styles.priceRow}><Text style={styles.price}>$7</Text><Text style={styles.period}>/ месяц</Text></View>
        <Text style={styles.trial}>3 месяца бесплатно</Text>
        <View style={styles.features}>
          <Text style={styles.feature}>Неограниченная загрузка PDF</Text>
          <Text style={styles.feature}>Чистая лента без рекламы</Text>
          <Text style={styles.feature}>Подписка управляется через RevenueCat</Text>
        </View>
        <Pressable disabled={loading} onPress={purchasePro} style={styles.button}>
          {loading ? <ActivityIndicator color="#101418" /> : <Text style={styles.buttonText}>Начать Pro</Text>}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.legal}>Подпиской можно управлять или отменить её в настройках App Store.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101418' },
  header: { height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#283139' },
  logo: { color: '#F6F3EA', fontSize: 20, fontWeight: '800' },
  close: { color: '#B6C1BD', fontSize: 13, fontWeight: '700' },
  content: { flex: 1, padding: 20, justifyContent: 'center' },
  kicker: { color: '#E47752', fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: '#F6F3EA', fontSize: 28, lineHeight: 34, fontWeight: '800', marginTop: 12 },
  subtitle: { color: '#B6C1BD', fontSize: 15, lineHeight: 22, marginTop: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 24 },
  price: { color: '#F6F3EA', fontSize: 46, fontWeight: '800' },
  period: { color: '#B6C1BD', fontSize: 16, marginLeft: 7 },
  trial: { color: '#B8D9C6', fontSize: 15, fontWeight: '700', marginTop: 2 },
  features: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#283139', paddingVertical: 15, marginTop: 22, gap: 9 },
  feature: { color: '#D7DEDA', fontSize: 14, lineHeight: 19 },
  button: { minHeight: 52, backgroundColor: '#E47752', borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  buttonText: { color: '#101418', fontSize: 16, fontWeight: '800' },
  error: { color: '#F0A38C', marginTop: 14, fontSize: 14 },
  legal: { color: '#7F8C8A', fontSize: 11, lineHeight: 16, marginTop: 14 },
});
