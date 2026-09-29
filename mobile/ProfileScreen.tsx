import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

export default function ProfileScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.profile}>
        <View style={styles.avatar}><Text style={styles.avatarText}>S</Text></View>
        <Text style={styles.name}>ScrollEd User</Text>
        <Text style={styles.handle}>@learner</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>FREE PLAN</Text></View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  profile: { alignItems: 'center', paddingTop: 70 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#E47752', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#101418', fontSize: 36, fontWeight: '800' },
  name: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 18 },
  handle: { color: '#929292', fontSize: 14, marginTop: 5 },
  badge: { marginTop: 18, paddingHorizontal: 14, minHeight: 30, borderWidth: 1, borderColor: '#E47752', borderRadius: 15, justifyContent: 'center' },
  badgeText: { color: '#E47752', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
});
