const angular = require('angular');
require('angular-route');
const omnifilterApp = angular.module('omnifilterApp', ['ngRoute']);

require('./services')(omnifilterApp);

require('./users')(omnifilterApp);
require('./auth')(omnifilterApp);

omnifilterApp.config(['$routeProvider', function(routes) {
  routes
    .when('/home', {
      controller: 'OmnifilterController',
      templateUrl: '/views/omnifilter_view.html'
    })
    .when('/', {
      redirectTo: '/home'
    })
    .when('/signup', {
      controller: 'SignupController',
      templateUrl: '/views/sign_up_in_view.html'
    })
    .when('/signin', {
      controller: 'SigninController',
      templateUrl: '/views/sign_up_in_view.html'
    })
    .otherwise({
      templateUrl: '/views/four_oh_four.html'
    });
}]);
