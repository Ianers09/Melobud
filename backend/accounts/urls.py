from django.urls import path

from . import views

urlpatterns = [
    path("csrf/", views.CsrfView.as_view()),
    path("me/", views.MeView.as_view()),
    path("register/", views.RegisterView.as_view()),
    path("verify/", views.VerifyEmailView.as_view()),
    path("resend-code/", views.ResendCodeView.as_view()),
    path("login/", views.LoginView.as_view()),
    path("username-available/", views.UsernameAvailableView.as_view()),
    path("logout/", views.LogoutView.as_view()),
    path("password/forgot/", views.ForgotPasswordView.as_view()),
    path("password/reset/", views.ResetPasswordView.as_view()),
    path("password/change/", views.ChangePasswordView.as_view()),
]
