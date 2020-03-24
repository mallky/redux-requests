import {
  getActionPayload,
  createSuccessAction,
  createErrorAction,
  createAbortAction,
} from '../actions';

const getDriver = (config, action) =>
  action.meta && action.meta.driver
    ? config.driver[action.meta.driver]
    : config.driver.default || config.driver;

const getLastActionKey = action =>
  action.type +
  (action.meta && action.meta.requestKey ? action.meta.requestKey : '');

const createSendRequestMiddleware = config => {
  const pendingRequests = {};

  return store => next => action => {
    const isWatchable =
      config.isRequestAction(action) &&
      (!action.meta || action.meta.runByWatcher !== false);

    if (isWatchable) {
      const driver = getDriver(config, action);
      const actionPayload = getActionPayload(action);
      const lastActionKey = getLastActionKey(action);
      const takeLatest =
        action.meta && action.meta.takeLatest !== undefined
          ? action.meta.takeLatest
          : typeof config.takeLatest === 'function'
          ? config.takeLatest(action)
          : config.takeLatest;

      if (takeLatest) {
        if (pendingRequests[lastActionKey]) {
          pendingRequests[lastActionKey].cancel();
        }
      }

      const responsePromise = driver(actionPayload.request, action);

      if (takeLatest) {
        if (responsePromise.cancel) {
          pendingRequests[lastActionKey] = responsePromise;
        }
      }

      responsePromise
        .then(response => {
          if (
            action.meta &&
            !action.meta.cacheResponse &&
            !action.meta.ssrResponse &&
            action.meta.getData
          ) {
            return { ...response, data: action.meta.getData(response.data) };
          }

          return response;
        })
        .then(response => {
          store.dispatch(createSuccessAction(action, response));
        })
        .catch(error => {
          console.log('error is', error);
          if (
            error !== 'REQUEST_ABORTED' &&
            action.meta &&
            action.meta.getError
          ) {
            throw action.meta.getError(error);
          }
          throw error;
        })
        .catch(error => {
          if (error === 'REQUEST_ABORTED') {
            store.dispatch(createAbortAction(action));
          } else {
            store.dispatch(createErrorAction(action, error));
          }
        });
    }

    return next(action);
  };
};

export default createSendRequestMiddleware;