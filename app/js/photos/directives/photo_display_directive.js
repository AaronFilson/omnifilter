//not too sure this file is needed, it was used in the transclude example

module.exports = function(app) {
  app.directive('photo', function() {
    return {
      restrict: 'AE',
      replace: true,
      templateUrl: '/templates/photos/directives/photo.html',
      scope: {
        photoData: '='
      }
    };
  });
};
