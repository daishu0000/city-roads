<template>
<div class='find-place' :class='{centered: boxInTheMiddle }'>
  <div class="settings" v-click-outside="onClickOutsideSettings">
    <button class="settings-btn" title="Settings" aria-label="Settings" type="button" @click="toggleSettings">
      <span class="settings-icon">⚙</span>
    </button>
    <div v-if="settingsVisible" class="settings-popover shadow">
    <div class="settings-header">Settings</div>
    <form class="settings-form" @submit.prevent>
      <label>
        <input type="radio" name="wayFilter" value="all" class="settings-radio" v-model="selectedFilterKey">
        All roads
      </label>
      <label>
        <input type="radio" name="wayFilter" value="main" class="settings-radio" v-model="selectedFilterKey">
        Main roads
      </label>
      <label>
        <input type="radio" name="wayFilter" value="buildings" class="settings-radio" v-model="selectedFilterKey">
        Buildings
      </label>
    </form>
  </div>
  </div>
  <div v-if='boxInTheMiddle'>
    <h3 class='site-header'>city roads</h3>
    <p class='description'>This website renders every single road within a city</p>
  </div>
  <form v-on:submit.prevent="onSubmit" class='search-box'>
      <input class='query-input' v-model='enteredInput' type='text' placeholder='Enter a city name to start' ref='input'>
      <a type='submit' class='search-submit' href='#' @click.prevent='onSubmit' v-if='enteredInput && !hideInput'>{{mainActionText}}</a>
  </form>
  <div v-if='showWarning' class='prompt message note shadow'>
    Note: Large cities may require 200MB+ of data transfer and may need a powerful device to render.
  </div>
  <div class='results' v-if='!loading'>
    <div v-if='suggestionsLoaded && suggestions.length' class='suggestions shadow'>
      <div class='prompt message'>
        <div>Select boundaries below to download all roads within</div>
        <div class='note'>large cities may require 200MB+ of data transfer and a powerful device</div>
      </div>
      <ul>
        <li v-for='(suggestion, index) in suggestions' :key="index">
          <a @click.prevent='pickSuggestion(suggestion)' class='suggestion'
          href='#'>
          <span>
          {{suggestion.name}} <small>({{suggestion.type}})</small>
          </span>
          </a>
        </li>
      </ul>
    </div>
    <div v-if='suggestionsLoaded && !suggestions.length && !loading && !error' class='no-results message shadow'>
      Didn't find matching cities. Try a different query?
    </div>
    <div v-if='noRoads' class='no-results message shadow'>
      Didn't find any roads. Try a different query?
    </div>
  </div>
  <div v-if='error' class='error message shadow'>
    <div>Sorry, we were not able to download data from the OpenStreetMap.
    It could be very busy at the moment processing other requests. <br/><br/> Please bookmark this website and <a href='#' @click.prevent="retry">try again</a> later?</div>
    <div class='error-links'>
      <a href='https://twitter.com/anvaka/status/1218971717734789120' title='see what it supposed to do' target="_blank">see how it should have worked</a>
      <a :href='getBugReportURL(error)' :title='"report error: " + error' target='_blank'>report this bug</a>
    </div>
  </div>
  <div v-if='loading' class='loading message shadow'>
    <loading-icon></loading-icon>
    <span>{{loading}}</span>
    <a href="#" @click.prevent='cancelRequest' class='cancel-request'>cancel</a>
    <div class='load-padding' v-if='stillLoading > 0'>
      Still loading...
    </div>
    <div class='load-padding' v-if='stillLoading > 1'>
      Sorry it takes so long!
    </div>
  </div>
  <div class="local-file">
    <label class="upload-btn">
      Select Local File
      <input type="file" @change="onFileChange" accept=".json,.osm,.xml" />
    </label>
  </div>
</div>
</template>

<script>
import LoadingIcon from './LoadingIcon.vue';
import Query from '../lib/Query.js';
import request from '../lib/request.js';
import findBoundaryByName from '../lib/findBoundaryByName.js';
import appState from '../lib/appState.js';
import Grid from '../lib/Grid.js';
import queryState from '../lib/appState.js';
import config from '../config.js';
import Progress from '../lib/Progress.js'
import LoadOptions from '../lib/LoadOptions.js';
import Pbf from 'pbf';
import {place} from '../proto/place.js';
import clickOutside from './clickOutside.js';

const FIND_TEXT = 'Find City Bounds';

export default {
  name: 'FindPlace',
  components: {
    LoadingIcon
  },
  directives: {
    clickOutside
  },
  data () {
    const enteredInput = appState.get('q') || '';
    let hasValidArea = restoreStateFromQueryString();

    return {
      enteredInput,
      loading: null,
      lastCancel: null,
      suggestionsLoaded: false,
      boxInTheMiddle: true,
      stillLoading: 0,
      error: null,
      hideInput: false,
      noRoads: false,
      clicked: false,
      showWarning: hasValidArea, 
      mainActionText: hasValidArea ? 'Download Area' : FIND_TEXT,
      suggestions: []
      ,
      settingsVisible: false,
      // possible values: 'all' | 'main' | 'buildings'
      selectedFilterKey: 'all'
    }
  },
  watch: {
    enteredInput() {
      // As soon as they change it, we need not to download:
      this.mainActionText = FIND_TEXT;
      this.showWarning = false;
      this.hideInput = false;
      appState.unsetPlace();
    }
  },
  mounted() {
    this.$refs.input.focus();
    if (queryState.get('auto')) {
      this.onSubmit();
    }
  },
  beforeUnmount() {
    if (this.lastCancel) this.lastCancel();
    clearInterval(this.notifyStillLoading);
  },
  methods: {
    toggleSettings() {
      this.settingsVisible = !this.settingsVisible;
    },

    onClickOutsideSettings() {
      this.settingsVisible = false;
    },

    // Return the actual Query.* string based on selected key
    getSelectedWayFilter() {
      if (this.selectedFilterKey === 'main') return Query.RoadMain;
      if (this.selectedFilterKey === 'buildings') return Query.Building;
      return Query.Road;
    },

    onSubmit() {
      queryState.set('q', this.enteredInput);
      this.cancelRequest()
      this.suggestions = [];
      this.noRoads = false;
      this.error = false;
      this.showWarning = false;
      
      this.settingsVisible = false;

      const restoredState = restoreStateFromQueryString(this.enteredInput);
      if (restoredState) {
        this.pickSuggestion(restoredState);
        return;
      }

      this.loading = 'Searching cities that match your query...'
      findBoundaryByName(this.enteredInput)
        .then(suggestions => {
          this.loading = null;
          this.hideInput = suggestions && suggestions.length;
          if (this.boxInTheMiddle) {
            // let animation that moves input box proceed a bit
            this.boxInTheMiddle = false; // This triggers transition
            // wait for it and then set the suggestions:
            setTimeout(() => {
              this.suggestionsLoaded = true;
              this.suggestions = suggestions;
            }, 50)
          } else {
              this.suggestionsLoaded = true;
              this.suggestions = suggestions; 
          }
        });
    },

    getBugReportURL(error) {
      let title = encodeURIComponent('OSM Error');
      let body = '';
      if (error) {
        body = 'Hello, an error occurred on the website:\n\n```\n' +
          error.toString() + '\n```\n\n Can you please help?';
      }

      return `https://github.com/anvaka/city-roads/issues/new?title=${title}&body=${encodeURIComponent(body)}`
    },

    updateProgress(status) {
      this.stillLoading = 0;
      clearInterval(this.notifyStillLoading);
      if (status.loaded < 0) {
        this.loading = 'Trying a different server'
        this.restartLoadingMonitor();
        return;
      }
      if (status.percent !== undefined) {
        this.loading = 'Loaded ' + Math.round(100 * status.percent) + '% (' + formatNumber(status.loaded) + ' bytes)...';
      } else {
        this.loading = 'Loaded ' + formatNumber(status.loaded) + ' bytes...';
      }
    },

    retry() {
      if (this.lastSuggestion) {
        this.pickSuggestion(this.lastSuggestion);
      }
    },

    pickSuggestion(suggestion) {
      this.lastSuggestion = suggestion;
      this.error = false;
      if (appState.isCacheEnabled() && suggestion.areaId) {
        this.checkCache(suggestion)
          .catch(error => {
            if (error.cancelled) return; // no need to do anything. They've cancelled

            // No Cache - fallback
            return this.useOSM(suggestion);
          });
      } else {
        // we don't have cache for nodes yet.
        this.useOSM(suggestion);
      }
    },

    restartLoadingMonitor() {
      clearInterval(this.notifyStillLoading);
      this.stillLoading = 0;
      this.notifyStillLoading = setInterval(() => {
        this.stillLoading++;
      }, 10000);
    },

    checkCache(suggestion) {
      this.loading = 'Checking cache...'
      let areaId = suggestion.areaId;

      return request(config.areaServer + '/' + areaId + '.pbf', {
        progress: this.generateNewProgressToken(),
        responseType: 'arraybuffer'
      }).then(arrayBuffer => {
        var byteArray = new Uint8Array(arrayBuffer);
        return byteArray;
      }).then(byteArray => {
        var pbf = new Pbf(byteArray);
        var obj = place.read(pbf);
        let grid = Grid.fromPBF(obj)
        this.$emit('loaded', grid);
      });
    },

    useOSM(suggestion) {
      this.loading = 'Connecting to OpenStreetMap...'
      
      // it may take a while to load data. 
      this.restartLoadingMonitor();
      Query.runFromOptions(new LoadOptions({
        wayFilter: this.getSelectedWayFilter(),
        areaId: suggestion.areaId,
        bbox: suggestion.bbox
      }), this.generateNewProgressToken())
      .then(grid => {
        this.loading = null;
        if (!grid.hasRoads()) {
          this.noRoads = true;
        } else {
          grid.setName(suggestion.name);
          grid.setId(suggestion.areaId || suggestion.osm_id);
          grid.setIsArea(suggestion.areaId); // osm nodes don't have area.
          grid.setBBox(serializeBBox(suggestion.bbox));
          this.$emit('loaded', grid);
        }
      }).catch(err => {
        if (err.cancelled) {
          this.loading = null;
          return;
        }
        console.error(err);
        this.error = err;
        this.loading = null;
        this.suggestions = [];
      })
      .finally(() => {
        clearInterval(this.notifyStillLoading);
        this.stillLoading = 0;
      });
    },

    cancelRequest() {
      if (this.progressToken) {
        this.progressToken.cancel();
        this.progressToken = null;
        this.loading = false;
      }
    },

    generateNewProgressToken() {
      if (this.progressToken) {
        this.progressToken.cancel();
        this.progressToken = null;
      }

      this.progressToken = new Progress(this.updateProgress);
      return this.progressToken;
    },
    onFileChange(e) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = () => {
        const content = reader.result;
        let json;

        const isXML = file.name.endsWith('.osm') || file.name.endsWith('.xml');

        if (isXML) {
          json = parseOSMXML(content);
        } else {
          json = JSON.parse(content);
        }
        const grid = Grid.fromOSMResponse(json.elements);
        grid.setName(file.name);
        grid.setId(0);
        grid.setIsArea(false);
        grid.setBBox(serializeBBox(null));

        this.$emit('loaded', grid);
      };
    }
  }
}

function serializeBBox(bbox) {
  return bbox && bbox.join(',');
}

function formatNumber(x) {
  if (!Number.isFinite(x)) return 'N/A';
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function restoreStateFromQueryString(name) {
  let areaId = getCurrentAreaId();
  if (areaId) {
    return {name, areaId};
  }

  let nodeAndBox = getCurrentNodeAndBox();
  if (nodeAndBox) {
    return {
      name,
      osm_id: nodeAndBox.osm_id,
      bbox: nodeAndBox.bbox
    };
  }
}

function getCurrentAreaId() {
  let areaId = appState.get('areaId');
  if (!Number.isFinite(Number.parseInt(areaId, 10))) {
    areaId = null;
  }
  return areaId;
}

function getCurrentNodeAndBox() {
  let osm_id = appState.get('osm_id');
  if (!Number.isFinite(Number.parseInt(osm_id, 10))) return;

  let bbox = parseBBox(appState.get('bbox'));
  if (!bbox) return;

  return { osm_id, bbox };
}

function parseBBox(bboxStr) {
  if (!bboxStr) return null;

  let bbox = bboxStr.split(',').map(x => Number.parseFloat(x)).filter(x => Number.isFinite(x));
  return bbox.length === 4 ? bbox : null;
}

function parseOSMXML(xmlString) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlString, "application/xml");

  const elements = [];

  // 处理 <node>
  xml.querySelectorAll('node').forEach(n => {
    const tags = [...n.querySelectorAll('tag')].map(t => ({
      k: t.getAttribute('k'),
      v: t.getAttribute('v')
    }));

    elements.push({
      type: 'node',
      id: Number(n.getAttribute('id')),
      lat: Number(n.getAttribute('lat')),
      lon: Number(n.getAttribute('lon')),
      tags
    });
  });

  // 处理 <way>
  xml.querySelectorAll('way').forEach(w => {
    const nds = [...w.querySelectorAll('nd')].map(nd => ({
      ref: Number(nd.getAttribute('ref'))
    }));

    const tags = [...w.querySelectorAll('tag')].map(t => ({
      k: t.getAttribute('k'),
      v: t.getAttribute('v')
    }));

    elements.push({
      type: 'way',
      id: Number(w.getAttribute('id')),
      nodes: nds.map(n => n.ref),
      tags
    });
  });

  // 处理 <relation>
  xml.querySelectorAll('relation').forEach(r => {
    const members = [...r.querySelectorAll('member')].map(m => ({
      type: m.getAttribute('type'),
      ref: Number(m.getAttribute('ref')),
      role: m.getAttribute('role')
    }));

    const tags = [...r.querySelectorAll('tag')].map(t => ({
      k: t.getAttribute('k'),
      v: t.getAttribute('v')
    }));

    elements.push({
      type: 'relation',
      id: Number(r.getAttribute('id')),
      members,
      tags
    });
  });

  return { elements };
}

</script>

<style lang="stylus">
@import('../vars.styl');
.find-place  {
  width: desktop-controls-width;
}

h3.site-header {
  margin: 0;
  font-weight: normal;
  font-size: 32px;
  text-align: center;
}

input {
  border: none;
  flex: 1;
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  padding: 0;
  color: #434343;
  height: 100%;
  font-size: 16px;
  &:focus {
    outline: none;
  }
}

.search-box {
  position: relative;
  background-color: emphasis-background;
  padding: 0 8px;
  padding: 0 0 0 8px;

  box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 -1px 0px rgba(0,0,0,0.02);
  height: 48px;
  display: flex;
  font-size: 16px;
  cursor: text;
  a {
    cursor: pointer;
  }
  span {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
}

.settings-btn {
  position: absolute;
  right: 8px;
  top: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: 4px;
  color: #666;
  z-index: 3;
}
.settings-btn:hover {
  background: rgba(0,0,0,0.05);
  color: highlight-color;
}
.settings-icon {
  font-size: 20px;
  line-height: 1;
}

.settings-popover {
  position: absolute;
  right: 8px;
  top: 50px;
  background: white;
  padding: 8px;
  border-radius: 4px;
  min-width: 130px;
  z-index: 10;
}
.settings-popover .settings-header {
  font-weight: bold;
  margin-bottom: 6px;
  font-size: 13px;
}
form{
  display: flex;
}
.settings-form {
  flex-direction: column;
}
.prompt {
  padding: 4px;
  text-align: center;
  font-size: 12px;
}

.search-submit {
  padding: 0 8px;
  align-items: center;
  text-decoration: none;
  display: flex;
  flex-shrink: 0;
  justify-content: center;
  outline: none;
  z-index: 1;
  color: highlight-color
  &:hover {
    color: emphasis-background;
    background: highlight-color;
  }
}

.suggestion {
  display: block
  min-height: 64px
  align-items: center;
  border-bottom: 1px solid border-color
  display: flex
  padding: 0 10px;
  text-decoration: none
  color: highlight-color
}

.suggestions {
  position: relative;
  background: white
  .note {
    font-size: 10px;
    font-style: italic;
  }

  ul {
    list-style-type: none;
    margin: 0;
    padding: 0;
    max-height: calc(100vh - 128px);
    overflow-y: auto;
    overflow-x: hidden;
  }
}

.message,
.loading {
  padding: 4px 8px;
  position: relative;
}
.loading svg {
  margin-right: 8px;
}

.shadow {
  box-shadow: 0 2px 4px rgba(0,0,0,0.2)
}

.error {
  overflow-x: auto;
}

.find-place {
  position: absolute;
  display: flex;
  flex-direction: column;
  top: 8px;
  left: 50%;

  transform: translateX(-50%) translateY(0);
  transition-timing-function: ease-out;
  transition-property: top left transform;
  transition-duration: 0.2s;
}

.find-place.centered {
  top: 50%;
  left: 50%;
  transform: translateX(-50%) translateY(-143px);
}
.load-padding {
  padding-left: 16px;
}
.description {
  padding: 8px;
  margin: 0;
  text-align: center;
}

.cancel-request {
  position: absolute;
  right: 4px;
  top: 4px;
  font-size: 12px;
}
.error-links {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

@media (max-width: small-screen) {
  .find-place {
    width: 100%;
  }
  .find-place.centered {
    top: 8px;
    left: 0;
    transform: none;
  }
  .message {
    font-size: 12px;
  }
  .prompt {
    font-size: 12px;
    .note {
      font-size: 9px;
    }
  }
}

input[type="file"] {
  display: none; /* 隐藏真实 file input */
}

.upload-btn {
  padding: 8px 16px;
  background: white;
  color: #ff4081;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid gray;
}

.local-file{
  margin-top: 16px;
}


</style>
