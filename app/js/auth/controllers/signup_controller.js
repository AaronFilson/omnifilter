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
            $scope.errors.push(err);
            return console.dir('Error in signing up user : ', err);
          }
          $scope.updateEmail();
          $location.path('/home');
        });
      };
    }]);
};
