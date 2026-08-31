sed -i '' 's/grade_id: params.grade_id,/gradeId: params.grade_id,/g' src/lib/ipc.ts
sed -i '' 's/teacher_score: params.teacher_score,/teacherScore: params.teacher_score,/g' src/lib/ipc.ts
sed -i '' 's/teacher_feedback: params.teacher_feedback,/teacherFeedback: params.teacher_feedback,/g' src/lib/ipc.ts
