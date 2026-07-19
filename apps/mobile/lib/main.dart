import 'package:flutter/material.dart';

void main() {
  runApp(const QchatApp());
}

class QchatApp extends StatelessWidget {
  const QchatApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Qchat',
      theme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xFF2AABEE),
        scaffoldBackgroundColor: const Color(0xFF0E1621),
      ),
      home: const Scaffold(
        body: Center(
          child: Text(
            'Qchat Mobile scaffold\nConfigure API base URL and run flutter pub get',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
