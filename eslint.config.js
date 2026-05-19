// eslint.config.js
export default [
  {
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off'
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        // 浏览器全局变量
        'console': 'readonly',
        'document': 'readonly',
        'window': 'readonly',
        'localStorage': 'readonly',
        'fetch': 'readonly',
        'requestAnimationFrame': 'readonly',
        'cancelAnimationFrame': 'readonly',
        'setTimeout': 'readonly',
        'clearTimeout': 'readonly',
        'setInterval': 'readonly',
        'clearInterval': 'readonly',
        'parseInt': 'readonly',
        'parseFloat': 'readonly',
        'JSON': 'readonly',
        'Date': 'readonly',
        'Map': 'readonly',
        'Set': 'readonly',
        'RegExp': 'readonly',
        'Error': 'readonly',
        'Promise': 'readonly',
        'Image': 'readonly',
        'FileReader': 'readonly',
        'AbortController': 'readonly',
        'URLSearchParams': 'readonly',
        'confirm': 'readonly',
        
        // 已声明的全局变量
        'API_BASE': 'writable',
        'currentUser': 'writable',
        'authToken': 'writable',
        'currentTab': 'writable',
        'authMode': 'writable',
        'unreadNotifs': 'writable',
        'LANES': 'readonly',
        'LANE_ICONS': 'readonly',
        'cacheStore': 'readonly',
        'compTier': 'writable',
        'TIER_CONFIG': 'readonly',
        'currentCoinSubTab': 'writable',
        'currentProfileTab': 'writable',
        'currentAdminSubTab': 'writable',
        'adminUsersFilter': 'writable',
        '_tradePlayerUserId': 'writable',
        '_tradeFromClubId': 'writable',
        '_spinnerRafId': 'writable',
        '_spinnerLastTick': 'writable',
        '_compCache': 'writable',
        '_myClubs': 'writable',
        '_marketPlayers': 'writable',
        '_marketContract': 'writable',
        '_marketPosFilters': 'writable',
        '_awardUserList': 'writable',
        'renderLeaderboardPanel': 'readonly',
        'switchLeaderboardTab': 'readonly',
        'loadLeaderboardData': 'readonly'
      }
    }
  }
];
