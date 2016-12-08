module.exports = function(app) {
  app.controller('SignupController',
  ['$scope', '$location', 'userAuth', function($scope, $location, auth) {
    $scope.signup = true;
    $scope.submit = function(user) {
      auth.createUser(user, function(err) {
        if (err) return console.dir('Error in signing up user : ' + err);
        $scope.updateEmail();
        $location.path('/home');
      });
    };
  }]);
};
