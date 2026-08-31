use criterion::{black_box, criterion_group, criterion_main, Criterion};
use gcr_app_lib::plagiarism::{tfidf::compare_all_tfidf, winnowing::compare_winnowing};
use rand::distributions::Alphanumeric;
use rand::{thread_rng, Rng};

fn generate_random_word() -> String {
    let length = rng.gen_range(3..10);
    (0..length)
        .map(|_| rng.sample(Alphanumeric) as char)
        .collect::<String>()
        .to_lowercase()
}

fn generate_fake_submission(word_count: usize) -> String {
    let mut words = Vec::with_capacity(word_count);
    for _ in 0..word_count {
        words.push(generate_random_word());
    }
    words.join(" ")
}

fn bench_plagiarism(c: &mut Criterion) {
    let mut group = c.benchmark_group("plagiarism_engine");
    group.sample_size(10); // Reduce sample size as these take some time

    let num_submissions = 100;
    let words_per_submission = 500;

    // Generate submissions
    let submissions: Vec<String> = (0..num_submissions)
        .map(|_| generate_fake_submission(words_per_submission))
        .collect();

    let docs_for_tfidf: Vec<(String, String)> = submissions
        .iter()
        .enumerate()
        .map(|(i, text)| (format!("doc{}", i), text.clone()))
        .collect();

    group.bench_function("winnowing_pair", |b| {
        b.iter(|| {
            // Compare first two
            compare_winnowing(black_box(&submissions[0]), black_box(&submissions[1]))
        })
    });

    group.bench_function("tfidf_all", |b| {
        b.iter(|| compare_all_tfidf(black_box(&docs_for_tfidf)))
    });

    group.finish();
}

criterion_group!(benches, bench_plagiarism);
criterion_main!(benches);
