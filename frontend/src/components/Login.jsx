import React, { useState } from 'react';
import API from '../api';
import { saveToken } from '../utils/auth';
import { useNavigate, Link } from 'react-router-dom';

export default function Login(){
  const [form, setForm] = useState({email:'', password:''});
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const change = e => setForm({...form, [e.target.name]: e.target.value});
  const submit = async e => {
    e.preventDefault(); setErr('');
    try {
      const res = await API('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(form)
      });
      if (res.token) {
        saveToken(res.token);
        nav('/');
      } else {
        setErr(res.msg || 'Login failed');
      }
    } catch { setErr('Network error'); }
  };

  return (
    <div className="auth">
      <h2>Login</h2>
      <form onSubmit={submit}>
        <input name="email" placeholder="email" onChange={change} type="email" required />
        <input name="password" placeholder="password" onChange={change} type="password" required />
        <button>Login</button>
      </form>
      {err && <p className="err">{err}</p>}
      <p>New here? <Link to="/register">Register</Link></p>
    </div>
  );
}
