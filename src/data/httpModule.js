import logFactory, { SERVER, STOREFROMSERVER } from './logFactory';
import farmSync from './farmSync';

const farm = () => {
  const host = localStorage.getItem('host');
  const user = localStorage.getItem('username');
  const password = localStorage.getItem('password');
  return farmSync(host, user, password);
};

export default {
  actions: {
    updateAreas({ commit }) {
      return farm().area.get().then((res) => {
        // If a successful response is received, delete and replace all areas
        commit('deleteAllAreas');
        const areas = res.map(({ tid, name, field_farm_geofield }) => ({ tid, name, field_farm_geofield })); // eslint-disable-line camelcase, max-len
        commit('addAreas', areas);
        console.log('Finished updating areas!');
      }).catch((err) => { throw err; });
    },
    updateAssets({ commit }) {
      return farm().asset.get().then((res) => {
        // If a successful response is received, delete and replace all assets
        commit('deleteAllAssets');
        const assets = res.map(({ id, name }) => ({ id, name }));
        commit('addAssets', assets);
        console.log('Finished updating assets!');
      }).catch((err) => { throw err; });
    },

    // SEND LOGS TO SERVER
    // May expand this function to accomodate replacement, or write a new one.
    // For the moment, I am trying a new one
    sendLogs({ commit, rootState }, payload) {
      // Update logs in the database and local store after send completes
      function handleSyncResponse(response, params) {
        let serverId = null;
        if (params.logId) {
          serverId = params.logId;
        } else {
          serverId = response.id;
        }
        commit('updateLogs', {
          indices: [params.logIndex],
          mapper(log) {
            return logFactory({
              ...log,
              id: serverId,
              wasPushedToServer: true,
              remoteUri: response.uri,
            });
          },
        });
      }

      function handleSyncError(error, index) {
        // Do something with a TypeError object (mostly likely no connection)
        if (typeof error === 'object' && error.status === undefined) {
          const errorPayload = {
            message: `Unable to sync "${rootState.farm.logs[index].name}" because the network is currently unavailable. Please try syncing again later.`,
            errorCode: error.statusText,
            level: 'warning',
            show: true,
          };
          commit('logError', errorPayload);
        } else if (error.status === 401 || error.status === 403) {
          // Reroute authentication or authorization errors to login page
          payload.router.push('/login');
        } else {
          // handle some other type of runtime error (if possible)
          const errorPayload = {
            message: `${error.status} error while syncing "${rootState.farm.logs[index].name}": ${error.statusText}`,
            errorCode: error.statusText,
            level: 'warning',
            show: true,
          };
          commit('logError', errorPayload);
        }
        commit('updateLogs', {
          indices: [index],
          mapper(log) {
            return logFactory({
              ...log,
              isReadyToSync: false,
            });
          },
        });
      }

      // Send records to the server, unless the user isn't logged in
      if (localStorage.getItem('token')) {
        payload.indices.map((index) => {
          // Either send or post logs, depending on whether they originated on the server
          // Logs originating on the server possess an ID field; others do not.
          const newLog = logFactory(rootState.farm.logs[index], SERVER);
          console.log('SENDING LOGS WITH PAYLOAD', newLog);
          if (newLog.id) {
            return farm().log.update(newLog, localStorage.getItem('token')) // eslint-disable-line no-use-before-define, max-len
              .then(res => handleSyncResponse(res, { logIndex: index, logId: newLog.id }))
              .catch(err => handleSyncError(err, index));
          }
          return farm().log.send(newLog, localStorage.getItem('token')) // eslint-disable-line no-use-before-define, max-len
            .then(res => handleSyncResponse(res, { logIndex: index }))
            .catch(err => handleSyncError(err, index));
        });
      } else {
        payload.router.push('/login');
      }
    },

    // GET LOGS FROM SERVER
    getServerLogs({ commit, rootState }, payload) {
      console.log(`GET SERVER LOGS CALLED IN HTTPMODULE WITH ${payload}`);
      return farm().log.get(payload, localStorage.getItem('token'))
        .then((res) => {
          console.log('LOGS RECEIVED AS ', res);
          // See whether logs are new, or currently in the store
          // If res is a single log, check vs current, run through the logFactory and call addLog
          // If res is multiple, check each vs current, run through logFactory and call addLogs
          function checkLog(serverLog) {
            const allLogs = rootState.farm.logs;
            console.log('ALL LOGS FROM ROOTSTATE: ', allLogs.length);
            const logStatus = { newLog: true, localChange: true }
            allLogs.forEach((localLog) => {
              if (localLog.id) {
                if (localLog.id === serverLog.id) {
                  logStatus.newLog = false;
                  console.log(`EXISTING LOG ${localLog.name} STATUS: `, localLog.wasPushedToServer)
                  if (localLog.wasPushedToServer) {
                    logStatus.localChange = false;
                  }
                }
              }
            });
            return logStatus;
          }
          // Return all assets/ areas associated with logs
          function getAttached(log, attribute, resources, resId) {
            console.log('LOG ATTRIBUTE:', log[attribute]);
            const logAttached = [];
            resources.forEach((resrc) => {
              log[attribute].forEach((attrib) => {
                if (resrc[resId] === attrib.id) {
                  logAttached.push(resrc);
                }
              })
            })
            console.log('ATTACHED RESOURCES:', logAttached);
            return logAttached;
          }

          // Process each log on its way from the server to the logFactory
          function processLog(log) {
            const allAreas = rootState.farm.areas;
            const allAssets = rootState.farm.assets;
            const checkStatus = checkLog(log);
            const attachedAssets = getAttached(log, 'field_farm_asset', allAssets, 'id');
            const attachedAreas = getAttached(log, 'field_farm_area', allAreas, 'tid');
            if (checkStatus.newLog) {
              commit('addLog', logFactory({
                ...log,
                wasPushedToServer: true,
                field_farm_area: attachedAreas,
                field_farm_asset: attachedAssets
              }, STOREFROMSERVER));
            } else if (checkStatus.localChange) {
              console.log(`LOG ${log.name} HAS BEEN CHANGED LOCALLY`);
            }
          }
          // Process one or more logs
          if (res.list) {
            res.list.forEach(log => processLog(log));
          } else {
            processLog(res);
          }
        })
        .catch((err) => { throw err; });
      // Errors are handled in index.js
    },

  },
};
