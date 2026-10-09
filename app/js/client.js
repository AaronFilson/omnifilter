const angular = require('angular');
require('angular-route');
const omnifilterApp = angular.module('omnifilterApp', ['ngRoute']);

require('./services')(omnifilterApp);

require('./auth')(omnifilterApp);
require('./photos')(omnifilterApp);

omnifilterApp.config(['$routeProvider', '$locationProvider', function(routes, $locationProvider) {
  // Angular 1.6+ defaults to '#!/' URLs; keep the '#/' links used in the views.
  $locationProvider.hashPrefix('');

  routes
    .when('/home', {
      controller: 'PhotosController',
      templateUrl: '/views/photo_view.html'
    })
    .when('/signup', {
      controller: 'SignupController',
      templateUrl: '/views/sign_up_in_view.html'
    })
    .when('/signin', {
      controller: 'SigninController',
      templateUrl: '/views/sign_up_in_view.html'
    })
    .when('/', {
      redirectTo: '/signin'
    })
    .otherwise({
      templateUrl: '/views/four_oh_four.html'
    });
}]);
