import React from 'react';
import { useNavigation } from '@react-navigation/native';
import StoryFeed from './StoryFeed';

export default function HomeFeed() {
  const navigation = useNavigation<any>();
  return <StoryFeed endpoint="/api/feed" onCategoryPress={(categoryId) => navigation.navigate('Themes', { screen: 'ThemeDetail', params: { categoryId } })} />;
}
