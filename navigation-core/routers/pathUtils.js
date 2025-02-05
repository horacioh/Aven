import pathToRegexp, { compile } from 'path-to-regexp';
import NavigationActions from '../NavigationActions';
import invariant from '../utils/invariant';

const queryString = require('query-string');

function intersect(a, b) {
  if (!a || !b) {
    return new Set();
  }
  const intersecting = new Set();
  a.forEach(v => {
    if (b.has(v)) {
      intersecting.add(v);
    }
  });
  return intersecting;
}

export const getParamsFromPath = (
  inputParams,
  pathMatch,
  pathMatchKeys,
  allowedParams,
) => {
  let allowedInputParams = inputParams;
  if (allowedParams) {
    allowedInputParams = {};
    allowedParams.forEach(paramName => {
      allowedInputParams[paramName] = inputParams[paramName];
    });
  }
  const params = pathMatch.slice(1).reduce(
    // iterate over matched path params
    (paramsOut, matchResult, i) => {
      const key = pathMatchKeys[i];
      if (!key || key.asterisk) {
        return paramsOut;
      }
      const paramName = key.name;

      let decodedMatchResult;
      if (matchResult) {
        try {
          decodedMatchResult = decodeURIComponent(matchResult);
        } catch (e) {
          // ignore `URIError: malformed URI`
        }
      }

      paramsOut[paramName] = decodedMatchResult || matchResult;
      return paramsOut;
    },
    {
      // start with the input(query string) params, which will get overridden by path params
      ...allowedInputParams,
    },
  );
  return params;
};
const getRestOfPath = (pathMatch, pathMatchKeys) => {
  const rest = pathMatch[pathMatchKeys.findIndex(k => k.asterisk) + 1];
  return rest;
};

export const urlToPathAndParams = (url, uriPrefix) => {
  const searchMatch = url.match(/^(.*)\?(.*)$/);
  const params = searchMatch ? queryString.parse(searchMatch[2]) : {};
  const urlWithoutSearch = searchMatch ? searchMatch[1] : url;
  const delimiter = uriPrefix || '://';
  let path = urlWithoutSearch.split(delimiter)[1];
  if (path === undefined) {
    path = urlWithoutSearch;
  }
  if (path === '/') {
    path = '';
  }
  if (path[path.length - 1] === '/') {
    path = path.slice(0, -1);
  }
  return {
    path,
    params,
  };
};

export const createPathParser = (
  childRouters,
  routeConfigs,
  { paths: pathConfigs = {}, disableRouteNamePaths, explicitParams = false },
) => {
  const pathsByRouteNames = {};
  let paths = [];

  // Build pathsByRouteNames, which includes a regex to match paths for each route. Keep in mind, the regex will pass for the route and all child routes. The code that uses pathsByRouteNames will need to also verify that the child router produces an action, in the case of isPathMatchable false (a null path).
  Object.keys(childRouters).forEach(routeName => {
    let pathPattern;

    // First check for paths on the router, then check the route config
    if (pathConfigs[routeName] !== undefined) {
      pathPattern = pathConfigs[routeName];
    } else {
      pathPattern = routeConfigs[routeName].path;
    }

    if (pathPattern === undefined) {
      // If the user hasn't specified a path at all nor disableRouteNamePaths, then we assume the routeName is an appropriate path
      pathPattern = disableRouteNamePaths ? null : routeName;
    }

    invariant(
      pathPattern === null || typeof pathPattern === 'string',
      `Route path for ${routeName} must be specified as a string, or null.`,
    );

    // the path may be specified as null, which is similar to empty string because it allows child routers to handle the action, but it will not match empty paths
    const isPathMatchable = pathPattern !== null;
    // pathPattern is a string with inline params, such as people/:id/*foo
    const exactReKeys = [];
    const exactRe = isPathMatchable
      ? pathToRegexp(pathPattern, exactReKeys)
      : null;
    const extendedPathReKeys = [];
    const isWildcard = pathPattern === '' || !isPathMatchable;
    const extendedPathRe = pathToRegexp(
      isWildcard ? '*' : `${pathPattern}/*`,
      extendedPathReKeys,
    );

    pathsByRouteNames[routeName] = {
      exactRe,
      exactReKeys,
      extendedPathRe,
      extendedPathReKeys,
      isWildcard,
      toPath: pathPattern === null ? () => '' : compile(pathPattern),
    };
  });

  const localRouteNamedParams = {};

  Object.keys(routeConfigs).forEach(routeName => {
    const routeConfig = routeConfigs[routeName];
    const namedDefaultParams = routeConfig.params
      ? Object.keys(routeConfig.params)
      : [];

    function getNamed(pathMatches) {
      return pathMatches
        .map(p => {
          const name = p.name;
          if (name !== 0) {
            return name;
          }
          return null;
        })
        .filter(n => !!n);
    }
    const pathConfig = pathsByRouteNames[routeName];

    const namedParams = new Set([
      ...namedDefaultParams,
      ...getNamed(pathConfig.extendedPathReKeys),
    ]);

    localRouteNamedParams[routeName] = namedParams;
  });

  const routeNamedParams = { ...localRouteNamedParams };

  Object.keys(childRouters).forEach(routeName => {
    const childRouter = childRouters[routeName];
    const childRouteNamedParams = childRouter
      ? childRouter.routeNamedParams || {}
      : {};
    const allChildParamNames = new Set();
    Object.keys(childRouteNamedParams).forEach(childRouteName => {
      childRouteNamedParams[childRouteName].forEach(a =>
        allChildParamNames.add(a),
      );
    });

    routeNamedParams[routeName] = new Set([
      ...localRouteNamedParams[routeName],
      ...allChildParamNames,
    ]);

    const conflictingParamNames = intersect(
      allChildParamNames,
      localRouteNamedParams[routeName],
    );
    if (conflictingParamNames.size && explicitParams) {
      throw new Error(
        `Conflicting param names for "${routeName}" route. Rename the ${Array.from(
          conflictingParamNames,
        )
          .map(n => `"${n}"`)
          .join(',')} param(s)`,
      );
    }
  });

  paths = Object.entries(pathsByRouteNames);

  const getActionForPathAndParams = (
    pathToResolve = '',
    inputParams = {},
    getActionConfig = {},
  ) => {
    // Attempt to match `pathToResolve` with a route in this router's routeConfigs, deferring to child routers

    const useExplicitParams = explicitParams || getActionConfig.explicitParams;

    for (const [routeName, path] of paths) {
      const { exactRe, exactReKeys, extendedPathRe, extendedPathReKeys } = path;
      const childRouter = childRouters[routeName];

      const exactMatch = exactRe && exactRe.exec(pathToResolve);

      if (exactMatch && exactMatch.length) {
        const extendedMatch =
          extendedPathRe && extendedPathRe.exec(pathToResolve);
        let childAction = null;
        if (extendedMatch && childRouter) {
          const restOfPath = getRestOfPath(extendedMatch, extendedPathReKeys);
          childAction = childRouter.getActionForPathAndParams(
            restOfPath,
            inputParams,
            {
              explicitParams: useExplicitParams,
            },
          );
        }

        const allowedParams =
          useExplicitParams && localRouteNamedParams[routeName];

        return NavigationActions.navigate({
          routeName,
          params: getParamsFromPath(
            inputParams,
            exactMatch,
            exactReKeys,
            allowedParams,
          ),
          action: childAction,
        });
      }
    }

    for (const [routeName, path] of paths) {
      const { extendedPathRe, extendedPathReKeys } = path;
      const childRouter = childRouters[routeName];

      const extendedMatch =
        extendedPathRe && extendedPathRe.exec(pathToResolve);

      if (extendedMatch && extendedMatch.length) {
        const restOfPath = getRestOfPath(extendedMatch, extendedPathReKeys);
        let childAction = null;
        if (childRouter) {
          childAction = childRouter.getActionForPathAndParams(
            restOfPath,
            inputParams,
            {
              explicitParams: useExplicitParams,
              hello: 'a',
            },
          );
        }
        if (!childAction) {
          continue;
        }
        const allowedParams =
          useExplicitParams && localRouteNamedParams[routeName];

        return NavigationActions.navigate({
          routeName,
          params: getParamsFromPath(
            inputParams,
            extendedMatch,
            extendedPathReKeys,
            allowedParams,
          ),
          action: childAction,
        });
      }
    }

    return null;
  };
  const getPathAndParamsForRoute = route => {
    const { routeName, params } = route;
    const childRouter = childRouters[routeName];
    const { toPath, exactReKeys } = pathsByRouteNames[routeName];
    const subPath = toPath(params);
    const nonPathParams = {};
    if (params) {
      Object.keys(params)
        .filter(paramName => !exactReKeys.find(k => k.name === paramName))
        .forEach(paramName => {
          nonPathParams[paramName] = params[paramName];
        });
    }
    if (childRouter) {
      // If it has a router it's a navigator.
      // If it doesn't have router it's an ordinary React component.
      const child = childRouter.getPathAndParamsForState(route);
      return {
        path: subPath ? `${subPath}/${child.path}` : child.path,
        params: child.params
          ? { ...nonPathParams, ...child.params }
          : nonPathParams,
      };
    }
    return {
      path: subPath,
      params: nonPathParams,
    };
  };
  return {
    getActionForPathAndParams,
    getPathAndParamsForRoute,
    routeNamedParams,
  };
};
