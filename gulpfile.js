const gulp = require('gulp');

const del = require('del');

function build() {
    del.sync(['dist/**/*']);

    return gulp.src('src/lib/**/*.js')
        .pipe(gulp.dest('dist'));
}

module.exports = {
    build,
}
