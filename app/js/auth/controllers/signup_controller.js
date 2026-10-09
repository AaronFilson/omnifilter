module.exports = function(app) {
  app.controller('SignupController',
    ['$scope', '$location', 'userAuth', function($scope, $location, auth) {
      $scope.errors = [];
      $scope.signup = true;

      $scope.dismissError = function(err) {
        $scope.errors.splice($scope.errors.indexOf(err), 1);
      };

      $scope.submit = function(user) {
        if (!user) {
          $scope.errors.push('Error: there was no info to submit.');
          return console.log('No information in the user object when calling submit!');
        }
        auth.createUser(user, function(err) {
          if (err) {
            // Only the server's message: the response object also holds the
            // request, password included.
            $scope.errors.push((err.data && err.data.msg) || 'Could not sign up.');
            return console.dir('Error in signing up user : ', err);
          }
          $scope.updateEmail();
          $location.path('/home');
        });
      };
    }]);
};
