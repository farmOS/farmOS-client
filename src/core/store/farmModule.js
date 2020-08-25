// A Vuex module for modelling the attributes of the farm itself.

import farmLog from '../../utils/farmLog';
import defaultResources from './defaultResources';
import { getRemoteLogs, sendRemoteLogs } from './http/sync';
import createQuery from '../../utils/createQuery';

// A function for updating an existing array of objects with an array of new
// objects. An identifier is provided to determine if each new object is an
// updated version of an existing object, or a unique object; an updated object
// will replace the existing object, while the unique object will be concated
// to the end of the array. The function returns a new array and does not mutate
// the existing array.
const updateArray = (arr, identifier, newElements) => {
  // A reducer function for finding and replacing elements in an array by
  // their identifier.
  const insert = replacements => (acc, cur) => {
    const replacement = replacements.find(rep => cur[identifier] === rep[identifier]);
    return replacement === undefined
      ? acc.concat(cur)
      : acc.concat(replacement);
  };
  // Sort newElements into unique and non-unique elements.
  const [uniqueElements, nonuniqueElements] = newElements
    .reduce(([uniEls, nonuniEls], curEl) => {
      if (!arr.some(el => curEl[identifier] === el[identifier])) {
        return [uniEls.concat(curEl), nonuniEls];
      }
      return [uniEls, nonuniEls.concat(curEl)];
    }, [[], []]);
  // Insert non-unique elements first, then concat the rest.
  return arr
    .reduce(insert(nonuniqueElements), [])
    .concat(uniqueElements);
};

// A factory function for generating adder mutations (eg, `addLogs`, etc).
const makeEntityAdder = (name, identifier) => (state, payload) => {
  // If the payload is an array of entities, use the updateArray function.
  if (Array.isArray(payload)) {
    state[name] = updateArray(state[name], identifier, payload);
  // If the payload is a single entity, and is not already in the store, concat it.
  } else if (!state[name].some(entity => entity[identifier] === payload[identifier])) {
    state[name] = state[name].concat(payload);
  // Otherwsise, replace the old entity with the new one.
  } else {
    const index = state[name].findIndex(entity => entity[identifier] === payload[identifier]);
    state[name].splice(index, 1, payload);
  }
};

export default {
  state: {
    logs: [],
    assets: [],
    areas: [],
    units: [],
    categories: [],
    resources: defaultResources,
  },
  getters: {
    equipment(state) {
      return state.assets.filter(a => a.type === 'equipment');
    },
  },
  mutations: {
    addLogs: makeEntityAdder('logs', 'localID'),
    addAssets: makeEntityAdder('assets', 'id'),
    addAreas: makeEntityAdder('areas', 'tid'),
    addUnits: makeEntityAdder('units', 'tid'),
    addCategories: makeEntityAdder('categories', 'tid'),
    // This action is intended as the main API for field modules to modify log
    // properties. By default it sets the log's metadata to reflect that the log
    // has not been cached locally, nor pushed to the server.
    updateLog(state, props) {
      const { updateLog } = farmLog(state.resources.log);
      const i = state.logs.findIndex(l => l.localID === props.localID);
      if (i < 0) {
        throw new Error('The updateLog action requires a localID among the '
          + 'props supplied as the payload. If the log does not have a localID '
          + 'yet, use the initializeLog action instead.');
      }
      const newLog = updateLog(state.logs[i], {
        // Set wasPushedToServer to false, but allow it to be overwritten by props.
        wasPushedToServer: false,
        ...props,
      });
      state.logs.splice(i, 1, newLog);
    },
    filterLogs(state, predicate) {
      const filteredLogs = state.logs.filter(predicate);
      state.logs = filteredLogs;
    },
    deleteLog(state, localID) {
      const index = state.logs.findIndex(log => log.localID === localID);
      state.logs.splice(index, 1);
    },
    deleteAllLogs(state) {
      state.logs = [];
    },
    deleteAllAssets(state) {
      state.assets = [];
    },
    deleteAllAreas(state) {
      state.areas = [];
    },
    deleteAllUnits(state) {
      state.units = [];
    },
    deleteAllCategories(state) {
      state.categories = [];
    },
    setFarmResources(state, res) {
      state.resources = res;
    },
  },
  actions: {
    initializeLog({ commit, dispatch, rootState }, initProps = {}) {
      const { createLog, updateLog } = farmLog(rootState.farm.resources.log);
      const modules = initProps.modules || [rootState.shell.currentModule];
      return new Promise((resolve, reject) => {
        dispatch('generateLogID').then((localID) => {
          // If the log is coming from the server, it will already have an id
          // and all its properties, so only needs to be updated w/ localID.
          const newLog = initProps.id
            ? updateLog(initProps, { localID })
            : createLog({ ...initProps, localID, modules });
          commit('addLogs', newLog);
          resolve(localID);
        }).catch(reject);
      });
    },
    loadLogs(context, payload) {
      const { commit, dispatch } = context;
      const { filters, localIDs } = payload;
      const query = createQuery(filters, localIDs);
      commit('filterLogs', query);
      return dispatch('loadCachedLogs', payload)
        .then(() => getRemoteLogs(context, payload))
        .then(() => { localStorage.setItem('syncDate', Math.floor(Date.now() / 1000)); });
    },
    syncLogs(context, payload) {
      return getRemoteLogs(context, payload)
        .then(() => sendRemoteLogs(context, payload))
        .then(() => { localStorage.setItem('syncDate', Math.floor(Date.now() / 1000)); });
    },
  },
};
