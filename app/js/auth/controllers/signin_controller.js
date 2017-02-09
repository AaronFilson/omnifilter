module.exports = function(app) {
  app.controller('SigninController',
    ['$scope', '$location', 'userAuth', function($scope, $location, auth) {
      $scope.errors = [];

      $scope.dismissError = function(err) {
        $scope.errors.splice($scope.errors.indexOf(err), 1);
      };

      $scope.submit = function(user) {
        if (!user) {
          $scope.errors.push('Error: there was no info to submit.');
          return console.log('No information in the user object when calling submit!');
        }
        auth.signIn(user, function(err) {
          if (err) {
            $scope.errors.push(err.data.msg);
            return console.log('Error in signing in user : ', err);
          }
          $scope.updateEmail();
          $location.path('/home');
        });
      };
    }]);
};
