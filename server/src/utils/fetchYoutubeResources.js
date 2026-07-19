// Real YouTube Data API v3 integration helper for Project Eklavya
export async function fetchYoutubeResources(topic, subject, grade) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'YOUR_REGENERATED_YOUTUBE_API_KEY' || apiKey.trim() === '') {
    console.warn('YouTube API Key not configured or placeholder used. Returning empty resources array.');
    return [];
  }

  try {
    const query = `${topic} ${subject} class ${grade} explanation`;
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&regionCode=IN&relevanceLanguage=hi&maxResults=5&key=${apiKey}`;

    const response = await fetch(searchUrl);
    if (!response.ok) {
      console.warn(`YouTube Data API responded with status ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.items)) {
      return [];
    }

    const allResources = data.items
      .filter(item => item?.id?.videoId && item?.snippet?.title && item?.snippet?.channelTitle)
      .map(item => ({
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        type: 'youtube',
        channel: item.snippet.channelTitle
      }));

    // Exclude brand names explicitly excluded (BYJU'S)
    const sanitizedResources = allResources.filter(r => !r.channel.toLowerCase().includes('byju'));

    // Preferred Indian educational channels list
    const preferredChannels = ['Physics Wallah', 'Vedantu', 'Unacademy', 'Khan Academy India', 'Aakash'];
    const filteredPreferred = sanitizedResources.filter(r =>
      preferredChannels.some(pref => r.channel.toLowerCase().includes(pref.toLowerCase()))
    );

    // Fall back to top 3 sanitized results if no preferred channels matched
    const finalSelection = filteredPreferred.length > 0 ? filteredPreferred : sanitizedResources;

    return finalSelection.slice(0, 3);
  } catch (error) {
    console.warn('fetchYoutubeResources error:', error.message);
    return [];
  }
}

export default fetchYoutubeResources;
