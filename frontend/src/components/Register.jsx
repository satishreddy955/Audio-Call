import React, { useState } from 'react';
import API from '../api';
import { saveToken } from '../utils/auth';
import { useNavigate, Link } from 'react-router-dom';

export default function Register(){
  const [form, setForm] = useState({username:'', email:'', password:''});
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const change = e => setForm({...form, [e.target.name]: e.target.value});
  const submit = async e => {
    e.preventDefault(); setErr('');
    try {
      const res = await API('/api/auth/register', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(form)
      });
      if (res.token) {
        saveToken(res.token);
        nav('/');
      } else {
        setErr(res.msg || 'Registration error');
      }
    } catch (err) { setErr('Network error'); }
  };

  return (
    <div className="auth">
      <h2>Register</h2>
      <form onSubmit={submit}>
        <input name="username" placeholder="username" onChange={change} required />
        <input name="email" placeholder="email" onChange={change} type="email" required />
        <input name="password" placeholder="password" onChange={change} type="password" required />
        <button>Register</button>
      </form>
      {err && <p className="err">{err}</p>}
      <p>Already have account? <Link to="/login">Login</Link></p>
    </div>
  );
}
