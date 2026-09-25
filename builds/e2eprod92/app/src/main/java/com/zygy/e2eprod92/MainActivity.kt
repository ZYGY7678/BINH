package com.zygy.e2eprod92

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    setContent { App() }
  }
}

@androidx.compose.runtime.Composable
fun App() {
  MaterialTheme { Surface { Text("E2E production trigger OK") } }
}
