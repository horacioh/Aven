import React from 'react';
import hoistStatics from 'hoist-non-react-statics';
import { withNavigation } from '../navigation-core';

export default function createNavigationAwareScrollable(Component: any) {
  const ComponentWithNavigationScrolling = withNavigation(
    class extends React.PureComponent<any> {
      static displayName = `withNavigationScrolling(${Component.displayName ||
        Component.name})`;

      _subscription: any;

      componentDidMount() {
        this._subscription = this.props.navigation.addListener(
          'refocus',
          () => {
            const scrollableNode = this.getNode();
            if (this.props.navigation.isFocused() && scrollableNode !== null) {
              if (scrollableNode.scrollToTop != null) {
                scrollableNode.scrollToTop();
              } else if (scrollableNode.scrollTo != null) {
                scrollableNode.scrollTo({ y: 0 });
              }
            }
          },
        );
      }

      getNode() {
        if (this._scrollRef === null) {
          return null;
        }

        if (this._scrollRef.getScrollResponder) {
          return this._scrollRef.getScrollResponder();
        } else if (this._scrollRef.getNode) {
          return this._scrollRef.getNode();
        } else {
          return this._scrollRef;
        }
      }

      componentWillUnmount() {
        if (this._subscription != null) {
          this._subscription.remove();
        }
      }

      render() {
        return (
          <Component
            ref={view => {
              this._scrollRef = view;
            }}
            {...this.props}
          />
        );
      }
    },
  );

  class NavigationAwareScrollable extends React.PureComponent<any> {
    static displayName = `NavigationAwareScrollable(${Component.displayName ||
      Component.name})`;

    _captureRef = view => {
      this._innerRef = view;
      this.props.onRef && this.props.onRef(view);
    };

    setNativeProps = (...args) => {
      return this._innerRef.getNode().setNativeProps(...args);
    };

    getScrollResponder = (...args) => {
      return this._innerRef.getNode().getScrollResponder(...args);
    };

    getScrollableNode = (...args) => {
      return this._innerRef.getNode().getScrollableNode(...args);
    };

    getInnerViewNode = (...args) => {
      return this._innerRef.getNode().getInnerViewNode(...args);
    };

    scrollTo = (...args) => {
      return this._innerRef.getNode().scrollTo(...args);
    };

    scrollToEnd = (...args) => {
      return this._innerRef.getNode().scrollToEnd(...args);
    };

    scrollWithoutAnimationTo = (...args) => {
      return this._innerRef.getNode().scrollWithoutAnimationTo(...args);
    };

    flashScrollIndicators = (...args) => {
      return this._innerRef.getNode().flashScrollIndicators(...args);
    };

    render() {
      return (
        <ComponentWithNavigationScrolling
          {...this.props}
          onRef={this._captureRef}
        />
      );
    }
  }

  return hoistStatics(NavigationAwareScrollable, Component);
}
