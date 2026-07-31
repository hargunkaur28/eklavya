import mongoose from 'mongoose'; import dotenv from 'dotenv'; dotenv.config();
const API='http://localhost:5000/api';
const su=await (await fetch(API+'/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Narr',email:'narr.'+Date.now()+'@t.test',password:'TestPass1!'})})).json();
const H={'Content-Type':'application/json',Authorization:'Bearer '+su.token};
await fetch(API+'/auth/profile-details',{method:'PATCH',headers:H,body:JSON.stringify({age:15,studyMedium:'CBSE',fatherName:'Ram Kumar',schoolName:'Govt Sr Sec School',schoolCity:'Ambala'})});
await mongoose.connect(process.env.MONGODB_URI);
const uid=new mongoose.Types.ObjectId(JSON.parse(Buffer.from(su.token.split('.')[1],'base64').toString()).userId);
// The DB default is false and ModuleQuiz treats false as OFF, so without this the
// autoplay assertion would pass by never firing — the preference being off is
// indistinguishable in the output from autoplay being broken.
await mongoose.connection.collection('users').updateOne({_id:uid},{$set:{autoNarrateQuizzes:true}});
const q=(t)=>({questionText:t,options:['A','B','C','D'],correctIndex:0,selectedIndex:1,isCorrect:false,topic:'Light',explanation:'Light reflects at equal angles from a smooth surface.'});
const dr=await mongoose.connection.collection('diagnosticresults').insertOne({userId:uid,grade:'Class 10',subject:'Science',subSubject:'',questions:[q('What is the angle of reflection when a ray strikes at 30 degrees?'),q('Which mirror is used in vehicle headlights?')],weakTopics:['Light'],strongTopics:[],recommendation:'Revise Light.',score:0,totalQuestions:2,createdAt:new Date()});
const rm=await mongoose.connection.collection('roadmaps').insertOne({userId:uid,diagnosticResultId:dr.insertedId,grade:'Class 10',subject:'Science',subSubject:'',totalDays:2,days:[
 {dayNumber:1,topic:'Light — Reflection and Refraction',focus:'Laws of reflection',estimatedMinutes:30,completed:false,content:'Light travels in straight lines. When a ray of light strikes a smooth polished surface such as a mirror it bounces back. This is called reflection. The angle of incidence equals the angle of reflection.',resources:[],contentGenerated:true,subtopics:[],moduleQuiz:{generated:false,generatedAt:null,questions:[]}},
 {dayNumber:2,topic:'Electricity',focus:'Ohm law',estimatedMinutes:30,completed:false,content:'Current flows through a conductor when a potential difference is applied across it.',resources:[],contentGenerated:true,subtopics:[],moduleQuiz:{generated:false,generatedAt:null,questions:[]}}],language:'en',archived:false,createdAt:new Date()});
await mongoose.disconnect(); process.stdout.write(su.token+' '+rm.insertedId);
