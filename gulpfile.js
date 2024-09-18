const gulp = require('gulp');
const fs = require('node:fs');

function build() {
    fs.rmSync('dist', {
        recursive: true,
        force: true,
    });

    return gulp.src('src/**/*.js')
        .pipe(gulp.dest('dist'));
}

module.exports = {
    build,
}
