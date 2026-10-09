const gulp = require('gulp');
const webpack = require('webpack-stream');
const sass = require('gulp-sass')(require('sass'));
const maps = require('gulp-sourcemaps');
const cleanCss = require('gulp-clean-css');

// gulp 5 reads files as utf8 text by default, which corrupts binary files.
const binary = { encoding: false };

gulp.task('html:dev', () => {
  return gulp.src(__dirname + '/app/**/*.html')
    .pipe(gulp.dest(__dirname + '/dist'));
});

gulp.task('css:dev', () => {
  return gulp.src(__dirname + '/app/**/*.css')
    .pipe(gulp.dest(__dirname + '/dist'));
});

gulp.task('sass:dev', () => {
  return gulp.src(__dirname + '/app/**/*.scss')
    .pipe(maps.init())
    .pipe(sass().on('error', sass.logError))
    .pipe(cleanCss())
    .pipe(maps.write('./'))
    .pipe(gulp.dest(__dirname + '/dist'));
});

gulp.task('images:dev', () => {
  return gulp.src(__dirname + '/app/images/**/*', binary)
    .pipe(gulp.dest(__dirname + '/dist/images'));
});

gulp.task('favicon:dev', () => {
  return gulp.src(__dirname + '/favicon.ico', binary)
    .pipe(gulp.dest(__dirname + '/dist/'));
});

gulp.task('webpack:dev', () => {
  return gulp.src('./app/js/client.js')
    .pipe(webpack({
      mode: 'development',
      devtool: 'source-map',
      output: {
        filename: 'bundle.js'
      }
    }))
    .pipe(gulp.dest(__dirname + '/dist'));
});

gulp.task('webpack:test', () => {
  return gulp.src(__dirname + '/app/test/test_entry.js')
    .pipe(webpack({
      mode: 'development',
      module: {
        rules: [
          {
            test: /\.html$/,
            loader: 'html-loader',
            // Plain strings for $templateCache; leave {{bindings}} in src alone.
            options: { esModule: false, sources: false }
          }
        ]
      },
      output: {
        filename: 'test_bundle.js'
      }
    }))
    .pipe(gulp.dest(__dirname + '/app/test/bndl/'));
});

gulp.task('build:dev', gulp.parallel('webpack:dev', 'html:dev', 'css:dev',
  'sass:dev', 'images:dev', 'favicon:dev'));
gulp.task('default', gulp.series('build:dev'));
