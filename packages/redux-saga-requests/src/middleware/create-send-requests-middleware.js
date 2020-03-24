import {
  getActionPayload,
  createSuccessAction,
  createErrorAction,
  createAbortAction,
} from '../actions';
import { ABORT_REQUESTS } from '../constants';

const getRequestTypeString = requestType =>
  typeof requestType === 'function' ? requestType.toString() : requestType;

const getKeys = requests =>
  requests.map(v =>
    typeof v === 'object'
      ? getRequestTypeString(v.requestType) + v.requestKey
      : getRequestTypeString(v),
  );

const getDriver = (config, action) =>
  action.meta && action.meta.driver
    ? config.driver[action.meta.driver]
    : config.driver.default || config.driver;

const getLastActionKey = action =>
  action.type +
  (action.meta && action.meta.requestKey ? action.meta.requestKey : '');

// TODO: remove to more functional style, we need object maps and filters
const createSendRequestMiddleware = config => {
  // TODO: clean not pending promises sometimes
  const pendingRequests = {};

  return store => next => action => {
    if (action.type === ABORT_REQUESTS) {
      const clearAll = !action.requests;
      const keys = !clearAll && getKeys(action.requests);

      if (!action.requests) {
        Object.values(pendingRequests).forEach(requests =>
          requests.forEach(r => r.cancel()),
        );
      } else {
        Object.entries(pendingRequests)
          .filter(([k]) => keys.includes(k))
          .forEach(([, requests]) => requests.forEach(r => r.cancel()));
      }

      return next(action);
    }

    if (
      config.isRequestAction(action) &&
      (!action.meta || action.meta.runByWatcher !== false)
    ) {
      const driver = getDriver(config, action);
      const actionPayload = getActionPayload(action);
      const lastActionKey = getLastActionKey(action);
      const takeLatest =
        action.meta && action.meta.takeLatest !== undefined
          ? action.meta.takeLatest
          : typeof config.takeLatest === 'function'
          ? config.takeLatest(action)
          : config.takeLatest;

      if (takeLatest && pendingRequests[lastActionKey]) {
        pendingRequests[lastActionKey].forEach(r => r.cancel());
      }

      const isBatchedRequest = Array.isArray(actionPayload.request);
      const responsePromises = isBatchedRequest
        ? actionPayload.request.map(r => driver(r, action))
        : [driver(actionPayload.request, action)];

      if (responsePromises[0].cancel) {
        pendingRequests[lastActionKey] = responsePromises;
      }

      Promise.all(responsePromises)
        .then(response =>
          isBatchedRequest
            ? response.reduce(
                (prev, current) => {
                  prev.data.push(current.data);
                  return prev;
                },
                { data: [] },
              )
            : response[0],
        )
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
