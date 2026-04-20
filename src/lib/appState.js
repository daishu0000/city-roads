import createQueryState from 'query-state';
import config from '../config.js';

const queryState = createQueryState({}, {useSearch: true});

/**
 * This is our base state. It just persists default information about
 * custom settings and integrates with query string.
 */
export default {
  isCacheEnabled() {
    const cacheFromQuery = queryState.get('cache');
    if (cacheFromQuery !== undefined && cacheFromQuery !== null) {
      return cacheFromQuery != 0;
    }

    return config.useAreaCache !== false;
  },
  enableCache() {
    return queryState.unset('cache');
  },
  get() {
    return queryState.get.apply(queryState, arguments);
  },
  set() {
    return queryState.set.apply(queryState, arguments);
  },
  unset() {
    return queryState.unset.apply(queryState, arguments);
  },

  unsetPlace() {
    queryState.unset('areaId');
    queryState.unset('osm_id');
    queryState.unset('bbox');
  }
}