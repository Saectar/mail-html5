define(function(require) {
    'use strict';

    var angular = require('angular'),
        appController = require('js/app-controller'),
        _ = require('underscore'),
        emailDao;

    //
    // Controller
    //

    var NavigationCtrl = function($scope) {
        $scope.navOpen = false;
        $scope.writerOpen = false;

        emailDao = appController._emailDao;

        //
        // scope functions
        //

        $scope.openNav = function() {
            $scope.navOpen = true;
        };

        $scope.closeNav = function() {
            $scope.navOpen = false;
        };

        $scope.openWriter = function(replyTo) {
            $scope.writerReply = !! (replyTo);
            $scope.writerOpen = true;
        };

        $scope.closeWriter = function() {
            $scope.writerOpen = false;
        };

        $scope.openFolder = function(folder) {
            $scope.currentFolder = folder;
            $scope.closeNav();
        };

        $scope.remove = function(email) {
            var trashFolder = _.findWhere($scope.folders, {
                type: 'Trash'
            });

            if ($scope.currentFolder === trashFolder) {
                emailDao.imapDeleteMessage({
                    folder: $scope.currentFolder.path,
                    uid: email.uid
                }, moved);
                return;
            }

            emailDao.imapMoveMessage({
                folder: $scope.currentFolder.path,
                uid: email.uid,
                destination: trashFolder.path
            }, moved);

            function moved(err) {
                var index;

                if (err) {
                    console.error(err);
                    return;
                }

                index = $scope.emails.indexOf(email);
                // show the next mail
                if ($scope.emails.length > 1) {
                    // if we're about to delete the last entry of the array, show the previous (i.e. the one below in the list), 
                    // otherwise show the next one (i.e. the one above in the list)
                    $scope.select(_.last($scope.emails) === email ? $scope.emails[index - 1] : $scope.emails[index + 1]);
                } else {
                    // if we have only one email in the array, show nothing
                    $scope.select();
                    $scope.selected = undefined;
                }
                $scope.emails.splice(index, 1);
                $scope.$apply();
            }
        };

        initFolders(function(folders) {
            $scope.folders = folders;
            // select inbox as the current folder on init
            $scope.openFolder($scope.folders[0]);
        });

        //
        // helper functions
        //

        function initFolders(callback) {
            if (window.chrome && chrome.identity) {
                emailDao.imapListFolders(function(err, folders) {
                    if (err) {
                        console.log(err);
                        return;
                    }

                    folders.forEach(function(f) {
                        f.count = 0;
                    });

                    callback(folders);
                    $scope.$apply();
                });
                return;
            }

            callback([{
                type: 'Inbox',
                count: 2,
                path: 'INBOX'
            }, {
                type: 'Sent',
                count: 0,
                path: 'SENT'
            }, {
                type: 'Outbox',
                count: 0,
                path: 'OUTBOX'
            }, {
                type: 'Drafts',
                count: 0,
                path: 'DRAFTS'
            }, {
                type: 'Trash',
                count: 0,
                path: 'TRASH'
            }]);
        }
    };

    //
    // Directives
    //

    var ngModule = angular.module('navigation', []);
    ngModule.directive('keyShortcuts', function() {
        return function(scope, elm) {
            elm.bind('keydown', function(e) {
                if (e.keyCode === 78 && !scope.$$childTail.writerOpen) {
                    // n -> new mail
                    e.preventDefault();
                    scope.$$childTail.openWriter();

                } else if (e.keyCode === 82 && !scope.$$childTail.writerOpen && scope.$$childTail.selected) {
                    // r -> reply
                    e.preventDefault();
                    scope.$$childTail.openWriter(scope.$$childTail.selected);

                } else if (e.keyCode === 27 && scope.$$childTail.writerOpen) {
                    // escape -> close writer
                    e.preventDefault();
                    scope.$$childTail.closeWriter();

                } else if (e.keyCode === 83 && !scope.$$childTail.writerOpen && scope.$$childTail.synchronize) {
                    // s -> sync folder
                    e.preventDefault();
                    scope.$$childTail.synchronize();
                }

                scope.$apply();
            });
        };
    });

    return NavigationCtrl;
});