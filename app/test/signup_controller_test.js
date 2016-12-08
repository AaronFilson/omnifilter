var angular = require('angular');

describe('Sign up controller basic', () => {
  var $httpBackend;
  var $scope;
  var $ControllerConstructor;
  var $window;
  var $location;
  var userAuth;

  beforeEach(angular.mock.module('omnifilterApp'));

  beforeEach(angular.mock.inject(function($rootScope, $controller, _$window_) {
    $ControllerConstructor = $controller;
    $scope = $rootScope.$new();
    $window = _$window_;
  }));

  it('should be able to make a controller', () => {

    var SignupController = $ControllerConstructor('SignupController', { $scope });
    expect(typeof SignupController).toBe('object');
    expect(typeof $scope.submit).toBe('function');
  });


  describe('function call', () => {
    beforeEach(angular.mock.inject(function(_$httpBackend_, _userAuth_) {
      $httpBackend = _$httpBackend_;
      $location = {};
      $location.path = function() { return 0; };
      userAuth = _userAuth_;
      $ControllerConstructor('SignupController', { $scope, $location, userAuth });
    }));

    afterEach(() => {
      $httpBackend.verifyNoOutstandingExpectation();
      $httpBackend.verifyNoOutstandingRequest();
    });

    it('should call to sign up', () => {
      var user = {
        password: 'tooshort?',
        email: 'Signuptester'
      };
      $scope.updateEmail = function() {
        $scope.email = 'Lester';
        $window.localStorage.token = 'wasHere';
      };

      $scope.email = 'startValue';
      $httpBackend.expectPOST('http://localhost:3000/signup')
      // .respond(200, { token: 'wasHere', email: 'Lester' });
      .respond(200, user);
      $scope.submit(user);
      $httpBackend.flush();
      expect($scope.email).toBe('Lester');
      expect($window.localStorage.token).toBe('wasHere');
    });

    it('should have an error on bad input', () => {
      // sending nothing, should get error from function
      $scope.email = 'Bad Email : No at !';
      $window.localStorage.token = 'Testing';
      $scope.updateEmail = function() {
        // this should not be called, as the error causes a return before it
        $scope.email = null;
        $window.localStorage.token = 'handle Error';
      };
      var errMsg = 'No user email!';
      $httpBackend.expectPOST('http://localhost:3000/signup')
      .respond(400, errMsg);
      $scope.submit('bad input');
      $httpBackend.flush();
      expect($scope.email).toBe('Bad Email : No at !');
      expect($window.localStorage.token).toBe('Testing');
    });
  });
});
