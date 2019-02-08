import { Observable, BehaviorSubject } from 'rxjs-compat';
import SHA1 from 'crypto-js/sha1';

const JSONStringify = require('json-stable-stringify');

export default function createCloudBlock({
  onNamedDispatch,
  id,
  value,
  lastFetchTime, // should be set if this block came from the server..
}) {
  let observedBlockId = null;
  if (value !== undefined) {
    const valueString = JSONStringify(value);
    observedBlockId = SHA1(valueString).toString();
  }
  const blockId = id || observedBlockId;
  if (!blockId) {
    throw new Error('Block id could not be determined!');
  }
  if (id && observedBlockId && id !== observedBlockId) {
    throw new Error(
      'id and value were both provided to createCloudBlock, but the id does not match the value!'
    );
  }

  if (!onNamedDispatch) {
    throw new Error('onNamedDispatch be provided to createCloudBlock!');
  }
  if (!blockId) {
    throw new Error('id or value must be provided to createCloudBlock!');
  }

  const blockState = new BehaviorSubject({
    // sync state:
    isConnected: value !== undefined,
    lastPutTime: null,
    lastFetchTime: lastFetchTime || null,

    // block data:
    value,
  });

  function getReference() {
    if (!blockId) {
      throw new Error(
        'Cannot getReference of an incomplete block without a value or id'
      );
    }
    return { type: 'BlockReference', id: blockId };
  }

  const observe = Observable.create(observer => {
    fetch()
      .then(() => {})
      .catch(console.error); // todo improve async error handling, set err state, etc..
    const upstreamSubscription = blockState.subscribe({
      next: val => {
        observer.next(val);
      },
    });
    return () => {
      upstreamSubscription.unsubscribe();
    };
  })
    .multicast(() => new BehaviorSubject(blockState.value))
    .refCount();

  function setState(newState) {
    blockState.next({
      ...blockState.value,
      ...newState,
    });
  }
  function getState() {
    return blockState.value;
  }
  function isPublished() {
    return !!blockState.value.lastPutTime || !!blockState.value.lastFetchTime;
  }
  function setPutTime() {
    setState({
      lastPutTime: Date.now(),
    });
  }
  function getValue() {
    return getState().value;
  }

  function getBlock() {
    return getState();
  }

  const observeValue = observe
    .map(state => {
      return state.value;
    })
    .filter(val => {
      return val !== undefined;
    });

  async function fetch() {
    if (getState().value !== undefined) {
      return;
    }
    const result = await onNamedDispatch({
      type: 'GetBlock',
      id,
    });
    if (!result || result.value === undefined) {
      throw new Error(`Error fetching block "${id}" from remote!`);
    }
    setState({
      value: result.value,
      lastFetchTime: Date.now(),
    });
  }

  async function fetchValue() {
    await fetch();
  }

  // async function put() {
  //   if (getState().value === undefined) {
  //     throw new Error(`Cannot put empty value from block "${blockId}"!`);
  //   }
  //   const res = await onNamedDispatch({
  //     type: 'PutBlock',
  //     value: getState().value,
  //   });
  //   setState({
  //     lastPutTime: Date.now(),
  //   });
  //   if (res.id !== blockId) {
  //     // if we get here, we are truly screwed!
  //     throw new Error(
  //       `Server and client blockIds do not match! Server: ${
  //         res.id
  //       }, Client: ${blockId}`
  //     );
  //   }
  //   return res;
  // }

  // function getValue() {
  //   return this._state.value;
  // }

  // return {
  //   fetch,
  //   put,
  //   observe,
  //   getValue,
  //   blockId,
  //   domain,
  //   observeValue,
  //   observeConnectedValue
  // };

  return {
    getId: () => blockId,
    id: blockId,
    get: () => {
      throw new Error('Cannot "get" on a block');
    },
    isPublished,
    setPutTime,
    getValue,
    fetch,
    fetchValue,
    getBlock,
    observe,
    observeValue,
    getReference,
  };
}
